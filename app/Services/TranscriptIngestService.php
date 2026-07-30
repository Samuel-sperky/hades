<?php

namespace App\Services;

use App\Events\MindPulse;
use App\Models\Area;
use App\Models\Node;
use App\Models\Tombstone;
use App\Services\Ingest\SessionClassifier;
use App\Services\Ingest\SessionLinker;
use App\Services\Ingest\SessionWriter;
use App\Services\Ingest\TranscriptParser;
use Illuminate\Support\Carbon;
use Throwable;

/**
 * Deterministický ingest Claude Code transcriptov (JSONL) — bez modelu.
 * Z každej session vytvorí memory uzol so source=session a meta detailmi.
 *
 * v3 (W2/P3): trieda je ORCHESTRÁTOR. Vlastnú prácu robia štyri vrstvy v
 * {@see \App\Services\Ingest}:
 *
 *   {@see TranscriptParser}    súbor → surový záznam (prompty, súbory, commity, tools)
 *   {@see SessionClassifier}   projekt → oblasť + oddelenie „Záznamy — <projekt>"
 *   {@see SessionWriter}       meta, zápis/aktualizácia uzla, zhrnutie a .md
 *   {@see SessionLinker}       projektová hrana, skill zmienky, posilnenia, podobnosť
 *
 * Chovanie sa rozsekaním nezmenilo (ingest beží každých 10 minút na živých
 * dátach): poradie krokov, stropy, prahy aj regexy sú prenesené verbatim.
 * Verejné rozhranie triedy zostáva rovnaké — `mind:ingest` a `mind:reorganize`
 * ju volajú bez zmeny.
 */
class TranscriptIngestService
{
    protected string $base;

    public function __construct(
        protected TranscriptParser $parser = new TranscriptParser(),
        protected SessionClassifier $classifier = new SessionClassifier(),
        protected SessionWriter $writer = new SessionWriter(),
        protected SessionLinker $linker = new SessionLinker(),
    ) {
        $this->base = rtrim((string) config('auraai.transcripts_path', '/transcripts'), '/');
    }

    /**
     * Spracuje všetky transcript súbory. $onlyNew spracuje len chýbajúce uzly
     * a súbory novšie než posledný zápis (meta.ingested_at). $forceRefresh
     * urobí plný refresh existujúcich uzlov (prepíše aj label/oblasť).
     */
    public function ingestAll(bool $onlyNew = true, bool $forceRefresh = false): array
    {
        $summary = ['processed' => 0, 'created' => 0, 'updated' => 0, 'skipped' => 0, 'files' => 0];

        // Náhrobky — zlúčené/archivované sessions sa už nikdy znovu nezapisujú
        $tombstoned = Tombstone::pluck('external_key')->flip();

        foreach ($this->transcriptFiles() as $path) {
            $summary['files']++;
            $key = 'session:'.pathinfo($path, PATHINFO_FILENAME);

            if ($tombstoned->has($key)) {
                $summary['skipped']++;

                continue;
            }

            if ($onlyNew && ! $forceRefresh) {
                $existing = Node::where('external_key', $key)->first(['id', 'meta']);
                if ($existing && ! $this->fileIsNewerThanIngest($path, $existing)) {
                    $summary['skipped']++;

                    continue;
                }
            }

            $result = $this->ingestFile($path, $forceRefresh);
            if ($result === null) {
                $summary['skipped']++;

                continue;
            }

            $summary['processed']++;
            $summary[$result]++;
        }

        return $summary;
    }

    public function transcriptFiles(): array
    {
        if (! is_dir($this->base)) {
            return [];
        }

        return glob($this->base.'/*/*.jsonl') ?: [];
    }

    /** @return 'created'|'updated'|null */
    public function ingestFile(string $path, bool $forceRefresh = false): ?string
    {
        if (! is_file($path)) {
            return null;
        }

        $rec = $this->parser->parse($path);
        if ($rec === null || empty($rec['prompts'])) {
            return null; // prázdna / systémová session
        }

        // Noise filter — potvrdzovacie prompty nejdú do meta ani do titulku
        [$prompts, $noiseFiltered] = $this->parser->filterNoise($rec['prompts']);
        $rec['prompts'] = $prompts;

        $sessionId = $rec['session_id'] ?: pathinfo($path, PATHINFO_FILENAME);
        $key = 'session:'.$sessionId;

        // Náhrobok — zlúčená/archivovaná session sa nesmie vrátiť ako zombie
        if (Tombstone::where('external_key', $key)->exists()) {
            return null;
        }

        $existing = Node::where('external_key', $key)->first();

        $meta = $this->writer->buildMeta($rec, $sessionId, $noiseFiltered, $existing);

        ['node' => $node, 'created' => $created, 'area' => $area, 'meta' => $meta] =
            $this->writer->upsert($rec, $key, $meta, $existing, $forceRefresh);

        $this->linker->linkToProject($node, $rec['project'], $area, $created);

        // SUMMARY + .md — pri vytvorení, a aj pri jednorazovom --force-refresh
        // (aby staršie záznamy dostali extraktívne zhrnutie a summaries/ súbor)
        if ($created || $forceRefresh) {
            $this->writer->writeSummary($node, $meta, $sessionId);
        }

        if ($created) {
            // prepojenia a pulz len pri skutočnom vzniku (hrany rieši mind:rewire)
            $this->linker->linkSkillMentions($node, $rec);
            $this->linker->strengthenUsedSkills($rec, $key);
            $this->linker->autoLinkSimilar($node);
            MindPulse::dispatch('node.created', ['node' => $node->toApi()]);
        }

        return $created ? 'created' : 'updated';
    }

    /** Súbor sa spracuje znova, len keď je novší než posledný zápis do uzla. */
    protected function fileIsNewerThanIngest(string $path, Node $node): bool
    {
        $ingestedAt = $node->meta['ingested_at'] ?? null;
        if (! is_string($ingestedAt) || $ingestedAt === '') {
            return true; // starší záznam bez ingested_at → považuj za neaktuálny
        }

        try {
            $last = Carbon::parse($ingestedAt)->getTimestamp();
        } catch (Throwable) {
            return true;
        }

        $mtime = @filemtime($path);

        return $mtime === false || $mtime > $last;
    }

    // ---- delegácie na vrstvy (stabilné verejné rozhranie pre príkazy) --------

    /** Používa `mind:reorganize`. @return array{0: ?Area, 1: ?\App\Models\Department} */
    public function classify(?string $project): array
    {
        return $this->classifier->classify($project);
    }

    public function resolveArea(?string $project): ?Area
    {
        return $this->classifier->resolveArea($project);
    }

    public function isNoisePrompt(string $prompt): bool
    {
        return $this->parser->isNoisePrompt($prompt);
    }
}
