<?php

namespace App\Services\Ingest;

use App\Models\Area;
use App\Models\Node;
use App\Services\SummaryService;
use Illuminate\Support\Carbon;
use Throwable;

/**
 * WRITER — jediná vrstva, ktorá zapisuje session uzol a jeho .md dokument.
 *
 * Vyčlenené z {@see \App\Services\TranscriptIngestService} (W2/P3) bez zmeny
 * chovania. Tri zápisové cesty zostávajú presne také, aké boli:
 *
 *  1. NOVÝ uzol      — `firstOrCreate` (nie `create`, viď komentár v {@see upsert()}),
 *                      spätne posunuté `created_at`, plný obsah;
 *  2. --force-refresh — plný refresh vrátane labelu/oblasti, sila zostáva;
 *  3. UPDATE          — len `meta` + `last_activated_at`; manuálne úpravy labelu,
 *                       popisu, oblasti a sily sa nikdy neprepíšu.
 */
class SessionWriter
{
    public function __construct(
        protected SessionClassifier $classifier = new SessionClassifier(),
        protected SessionTitler $titler = new SessionTitler(),
        protected SummaryService $summaries = new SummaryService(),
        protected SessionSummarizer $summarizer = new SessionSummarizer(),
    ) {}

    /**
     * Zloží meta záznamu. Kľúče sú kontrakt — čítajú ich dashboard, denník,
     * knižnica aj {@see SummaryService}, takže sa smú len pridávať.
     *
     * @param  array<string, mixed>  $rec
     * @return array<string, mixed>
     */
    public function buildMeta(array $rec, string $sessionId, int $noiseFiltered, ?Node $existing): array
    {
        $meta = [
            'session_id' => $sessionId,
            'project' => $rec['project'],
            'cwd' => $rec['cwd'],
            'git_branch' => $rec['git_branch'],
            'started_at' => $rec['started_at'],
            'ended_at' => $rec['ended_at'],
            'prompt_count' => count($rec['prompts']),
            'prompts' => array_slice($rec['prompts'], 0, 8),
            'noise_filtered' => $noiseFiltered,
            'files' => array_slice($rec['files'], 0, 20),
            'file_count' => count($rec['files']),
            'commits' => $rec['commits'],
            'tools' => $rec['tools'],
            'final' => $rec['final'],
            'ingested_at' => now()->toIso8601String(),
        ];

        // kľúče pohltené archívom/merge zostávajú v meta zachované
        if (! empty($existing?->meta['absorbed_keys'])) {
            $meta['absorbed_keys'] = $existing->meta['absorbed_keys'];
        }

        return $meta;
    }

    /**
     * Zapíše alebo aktualizuje session uzol.
     *
     * @param  array<string, mixed>  $rec
     * @param  array<string, mixed>  $meta
     * @return array{node: Node, created: bool, area: ?Area, meta: array<string, mixed>}
     *                                                                                   `meta` je vrátené preto, že sa mohlo doplniť o audit titulku
     */
    public function upsert(array $rec, string $key, array $meta, ?Node $existing, bool $forceRefresh): array
    {
        $lastActivatedAt = $rec['ended_at'] ? Carbon::parse($rec['ended_at']) : now();
        $created = false;

        if (! $existing) {
            [$area, $department] = $this->classifier->classify($rec['project']);
            $label = $this->titler->title($rec);
            $meta = $this->withTitleAudit($meta);

            // firstOrCreate, NIE create: medzi SELECT-om vyššie a týmto zápisom môže ten
            // istý kľúč vložiť iný beh — 10-minútový mind:ingest vs nočný --all, alebo dve
            // súbežné Claude Code sessions píšuce do práve prebiehajúceho transcriptu.
            // Check-then-act tu padal na nodes_external_key_unique (SQLSTATE[23000]),
            // doložené 3× v laravel.log za 13 dní.
            $node = Node::firstOrCreate(
                ['external_key' => $key],
                [
                    'type' => 'memory',
                    'source' => 'session',
                    'area_id' => $area?->id,
                    'department_id' => $department?->id,
                    'label' => $label,
                    'description' => $this->titler->describe($rec),
                    'meta' => $meta,
                    'strength' => 1,
                    'last_activated_at' => $lastActivatedAt,
                ],
            );
            $created = $node->wasRecentlyCreated;

            if ($created) {
                // umelo posunúť created_at na začiatok session (pre časovú os / denník)
                if ($rec['started_at']) {
                    $node->forceFill(['created_at' => Carbon::parse($rec['started_at'])])->save();
                }
            } else {
                // Preteky sme prehrali — uzol medzitým vytvoril iný beh. Ideme UPDATE cestou
                // (len meta + last_activated_at), aby sme neprepísali jeho label/popis ani
                // nezdvojili hrany, .md súbor a pulz. Náš titulok sa nepoužil, takže
                // audit k nemu v meta nesmie zostať.
                $meta = $this->withoutTitleAudit($meta);
                $node->fill([
                    'meta' => $meta,
                    'last_activated_at' => $lastActivatedAt,
                ])->save();
            }
        } elseif ($forceRefresh) {
            // jednorazová oprava: plný refresh vrátane labelu/oblasti/oddelenia,
            // silu zachová (nikdy ju neresetuje späť na 1)
            [$area, $department] = $this->classifier->classify($rec['project']);
            $label = $this->titler->title($rec);
            $meta = $this->withTitleAudit($meta);

            $existing->fill([
                'type' => 'memory',
                'source' => 'session',
                'area_id' => $area?->id,
                'department_id' => $department?->id,
                'label' => $label,
                'description' => $this->titler->describe($rec),
                'meta' => $meta,
                'last_activated_at' => $lastActivatedAt,
            ])->save();
            $node = $existing;
        } else {
            // UPDATE: iba meta + last_activated_at — manuálne úpravy labelu,
            // popisu, oblasti a sily zostávajú nedotknuté
            $area = $this->classifier->resolveArea($rec['project']);

            $existing->fill([
                'meta' => $meta,
                'last_activated_at' => $lastActivatedAt,
            ])->save();
            $node = $existing;
        }

        return ['node' => $node, 'created' => $created, 'area' => $area, 'meta' => $meta];
    }

    /**
     * Zhrnutie do popisu uzla + .md dokument do summaries/sessions/<id>.md.
     * Volá sa pri vytvorení a pri --force-refresh (aby staršie záznamy dostali
     * zhrnutie a summaries/ súbor).
     *
     * @param  array<string, mixed>  $meta
     * @return array<string, mixed>  meta doplnené o summary_path (a audit pri LLM)
     */
    public function writeSummary(Node $node, array $meta, string $sessionId): array
    {
        [$summaryText, $generatedBy] = $this->summarizer->summarize($meta);
        if (trim($summaryText) !== '') {
            $node->description = $summaryText;
        }
        if ($generatedBy !== null) {
            // audit podľa rozhodnutia #129/#135 — pri extraktívnom zhrnutí kľúče nevznikajú
            $meta['summary_by'] = 'llm';
            $meta['generated_by']['description'] = $generatedBy;
        }

        // .md dokument session do summaries/sessions/<id>.md — pri abstraktívnom
        // zhrnutí musí niesť to isté, čo popis uzla
        $override = $generatedBy !== null ? $summaryText : null;
        $safeId = preg_replace('/[^A-Za-z0-9._-]+/', '_', $sessionId);
        $relPath = 'summaries/sessions/'.$safeId.'.md';
        if ($this->writeMarkdown($relPath, $this->summaries->toMarkdown($node, $meta, $override))) {
            $meta['summary_path'] = $relPath;
        }
        $node->forceFill(['meta' => $meta])->save();

        return $meta;
    }

    /**
     * Doplní audit `meta.generated_by.label`, keď titulok navrhol model
     * (rozhodnutie #135). Pri heuristickom titulku kľúč vôbec nevznikne, takže
     * meta je pri vypnutom modeli bit-identické s dnešným.
     *
     * `generated_by` je mapa `pole → {model, at, task}` — polí, ktoré smie model
     * navrhnúť, je viac než jedno (label, description), takže plochý tvar
     * z kontraktu by sa prepisoval. Konvencia je zdokumentovaná v
     * `docs/zlozkovanie.md`.
     *
     * @param  array<string, mixed>  $meta
     * @return array<string, mixed>
     */
    protected function withTitleAudit(array $meta): array
    {
        $audit = $this->titler->generatedBy();
        if ($audit !== null) {
            $meta['generated_by']['label'] = $audit;
        }

        return $meta;
    }

    /**
     * @param  array<string, mixed>  $meta
     * @return array<string, mixed>
     */
    protected function withoutTitleAudit(array $meta): array
    {
        unset($meta['generated_by']['label']);
        if (($meta['generated_by'] ?? []) === []) {
            unset($meta['generated_by']);
        }

        return $meta;
    }

    /**
     * Zapíše markdown do <base_path>/<relPath>, vytvorí adresár ak treba.
     * Repo je v kontajneri writable. Vráti true pri úspechu.
     */
    protected function writeMarkdown(string $relPath, string $contents): bool
    {
        try {
            $full = base_path($relPath);
            $dir = dirname($full);
            if (! is_dir($dir)) {
                @mkdir($dir, 0775, true);
            }

            return @file_put_contents($full, $contents) !== false;
        } catch (Throwable) {
            return false;
        }
    }
}
