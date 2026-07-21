<?php

namespace App\Services\Brain;

use App\Events\MindPulse;
use App\Models\Area;
use App\Models\BrainSource;
use App\Models\Department;
use App\Models\Edge;
use App\Models\Node;
use App\Models\SyncRun;
use App\Models\Tag;
use App\Models\Tombstone;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Full brain → DB sync („markdown je master") pre origin=brain uzly.
 *
 * Upsert identita = external_key (zachovaná z MindSeedSkills / ClaudeMemory →
 * adopcia bez duplicít, Risk #2). content_hash je sha256 celého súboru:
 * in-memory dedupe PRED zápisom bráni kolízii UNIQUE (Risk #3). strength sa
 * NIKDY neresetuje. wiki hrany sa tvoria z [[odkazov]] idempotentne (bez
 * inflácie váhy). Zmiznuté súbory → needs_review (R7, nemažú sa hneď).
 *
 * Celý beh serializuje Cache::lock('brain-sync') — sync z UI/API/scheduleru/
 * writeru nikdy nebeží naraz. Dry-run zabalí prácu do transakcie a rollbackne.
 */
class BrainSyncService
{
    /** wiki=3 (medzi skill_mention=2 a manual=4) — zrkadlo MindService::KIND_RANK. */
    private const KIND_RANK = [
        'similarity' => 0,
        'co_activation' => 1,
        'skill_mention' => 2,
        'wiki' => 3,
        'manual' => 4,
    ];

    /** @var array<string, ?int> */
    private array $areaCache = [];

    /** @var array<string, int> */
    private array $deptCache = [];

    public function __construct(
        private readonly BrainSourceRegistry $registry = new BrainSourceRegistry,
        private readonly BrainFileParser $parser = new BrainFileParser,
    ) {}

    /**
     * @return array{run_id: ?int, status: string, stats: array<string, int>, dry_run: bool}
     *
     * @throws LockTimeoutException  keď už iný sync drží zámok (API → 423, command exit≠0)
     */
    public function sync(?string $sourceKey = null, bool $dryRun = false): array
    {
        $lock = Cache::lock('brain-sync', 600);

        if (! $lock->get()) {
            // iný sync (UI/API/scheduler/writer) práve beží
            throw new LockTimeoutException('brain-sync lock je obsadený');
        }

        try {
            return $this->run($sourceKey, $dryRun);
        } finally {
            $lock->release();
        }
    }

    /**
     * @return array{run_id: ?int, status: string, stats: array<string, int>, dry_run: bool}
     */
    private function run(?string $sourceKey, bool $dryRun): array
    {
        $this->areaCache = [];
        $this->deptCache = [];

        $stats = [
            'created' => 0,
            'updated' => 0,
            'skipped' => 0,          // nezmenené (žiaden dirty)
            'skipped_dup_hash' => 0, // rovnaký content_hash v tomto behu / v DB
            'skipped_mirror' => 0,   // súbor s node_id/source:hades frontmatterom (R3)
            'edges_created' => 0,
            'flagged_missing' => 0,  // R7 — zmiznuté súbory → needs_review
            'sources' => 0,
        ];

        $run = $dryRun ? null : SyncRun::create([
            'source' => $sourceKey,
            'started_at' => now(),
        ]);

        if ($dryRun) {
            DB::beginTransaction();
        }

        try {
            $sources = array_values(array_filter(
                $this->registry->sources(),
                fn ($s) => ($s['enabled'] ?? true) && ($sourceKey === null || $s['key'] === $sourceKey),
            ));
            $stats['sources'] = count($sources);

            // 1) parse + in-memory dedupe podľa content_hash PRED zápisom
            /** @var array<string, BrainNode> $byHash */
            $byHash = [];
            /** @var list<array{node: BrainNode}> $accepted */
            $accepted = [];

            foreach ($this->registry->files($sourceKey) as $descriptor) {
                $raw = @file_get_contents($descriptor['abs_path']);
                if ($raw === false) {
                    continue;
                }

                // R3 mirror-guard: súbor s node_id / source:hades = Hadesov vlastný
                // export → NIKDY z neho netvor uzol (bránime export↔index slučke).
                $fm = Frontmatter::parse($raw);
                if (isset($fm['node_id']) || ($fm['source'] ?? null) === 'hades') {
                    $stats['skipped_mirror']++;

                    continue;
                }

                // náhrobok — pohltený external_key sa už nesmie vrátiť
                if (Tombstone::where('external_key', $descriptor['external_key'])->exists()) {
                    continue;
                }

                $brainNode = $this->parser->parse($raw, $descriptor);

                if (isset($byHash[$brainNode->contentHash])) {
                    // rovnaký normalizovaný obsah na dvoch miestach → 1 uzol, prvý vyhráva
                    $stats['skipped_dup_hash']++;

                    continue;
                }
                $byHash[$brainNode->contentHash] = $brainNode;
                $accepted[] = ['node' => $brainNode];
            }

            // 2) upsert podľa external_key
            $seenKeys = [];
            /** @var array<int, list<string>> $wikiByNode  node_id → [[odkazy]] */
            $wikiByNode = [];

            foreach ($accepted as $row) {
                /** @var BrainNode $bn */
                $bn = $row['node'];
                $seenKeys[$bn->externalKey] = true;

                $node = $this->upsert($bn, $stats, ! $dryRun);
                if ($node === null) {
                    continue; // dup content_hash na inom external_key (Risk #3)
                }

                if ($bn->wikiLinks !== []) {
                    $wikiByNode[$node->id] = $bn->wikiLinks;
                }
            }

            // 3) wiki hrany z [[odkazov]] (R6) — idempotentné, bez inflácie váhy
            if ($wikiByNode !== []) {
                $this->syncWikiEdges($wikiByNode, $stats, ! $dryRun);
            }

            // 4) R7 — brain uzly v scope, ktorých súbor zmizol → needs_review
            $this->flagMissing($sources, $seenKeys, $stats);

            // 5) evidencia zdrojov (last_synced_at)
            if (! $dryRun) {
                $this->recordSources($sources);
            }

            $status = 'ok';

            if ($dryRun) {
                DB::rollBack();
            } else {
                $run?->update([
                    'finished_at' => now(),
                    'status' => $status,
                    'stats' => $stats,
                ]);
            }

            return ['run_id' => $run?->id, 'status' => $status, 'stats' => $stats, 'dry_run' => $dryRun];
        } catch (\Throwable $e) {
            if ($dryRun) {
                DB::rollBack();
            } else {
                $run?->update([
                    'finished_at' => now(),
                    'status' => 'error',
                    'stats' => $stats,
                    'message' => Str::limit($e->getMessage(), 500),
                ]);
            }

            throw $e;
        }
    }

    /**
     * updateOrCreate uzla podľa external_key. strength/pinned/verified_at sa pri
     * update NIKDY neresetujú; origin sa preklopí na 'brain'.
     *
     * @param  array<string, int>  $stats
     */
    private function upsert(BrainNode $bn, array &$stats, bool $emit): ?Node
    {
        $existing = Node::where('external_key', $bn->externalKey)->first();

        // content_hash je UNIQUE — ak ho už drží INÝ uzol, tento preskoč (Risk #3)
        $clash = Node::where('content_hash', $bn->contentHash)
            ->when($existing, fn ($q) => $q->where('id', '!=', $existing->id))
            ->when(! $existing, fn ($q) => $q->where('external_key', '!=', $bn->externalKey))
            ->exists();
        if ($clash) {
            $stats['skipped_dup_hash']++;

            return null;
        }

        $areaId = $this->areaId($bn->areaSlug);
        $deptId = $bn->departmentName ? $this->deptId($areaId, $bn->departmentName) : null;

        // last_activated_at ZÁMERNE mimo payloadu na dirty-check — inak by každý
        // beh označil všetky uzly za „updated" a idempotencia by bola len zdanlivá.
        $payload = [
            'type' => $bn->type,
            'source' => $bn->source,
            'origin' => 'brain',
            'area_id' => $areaId,
            'department_id' => $deptId,
            'label' => $bn->label,
            'description' => $bn->description,
            'certainty' => $bn->certainty,
            'source_file' => $bn->sourceFile,
            'content_hash' => $bn->contentHash,
            'meta' => $bn->meta,
        ];

        if ($existing === null) {
            $node = Node::create([
                'external_key' => $bn->externalKey,
                'needs_review' => $bn->needsReview,
                // skill uzly seedujeme silou 3 (parita s MindSeedSkills), inak 1
                'strength' => $bn->type === 'skill' ? 3 : 1,
                'last_activated_at' => now(),
                ...$payload,
            ]);

            $this->syncTags($node, $bn->tags);
            $stats['created']++;

            if ($emit) {
                MindPulse::dispatch('node.created', ['node' => $node->fresh()->toApi()]);
            }

            return $node;
        }

        // strength/pinned/verified_at/needs_review sa NEDOTÝKAME (review workflow
        // + „strength sa nikdy neresetuje")
        $existing->fill($payload);
        if ($existing->isDirty()) {
            $existing->last_activated_at = now();
            $existing->save();
            $stats['updated']++;
            if ($emit) {
                MindPulse::dispatch('node.updated', ['node' => $existing->fresh()->toApi()]);
            }
        } else {
            $stats['skipped']++;
        }

        $this->syncTags($existing, $bn->tags);

        return $existing;
    }

    /**
     * Pripojí tagy (M:N) aditívne — manuálne pridané tagy sa nezmažú.
     *
     * @param  list<string>  $tags
     */
    private function syncTags(Node $node, array $tags): void
    {
        $ids = [];
        foreach ($tags as $name) {
            $name = trim((string) $name);
            if ($name === '') {
                continue;
            }
            $ids[] = Tag::firstOrCreate(['name' => $name])->id;
        }
        if ($ids) {
            $node->tags()->syncWithoutDetaching($ids);
        }
    }

    /**
     * Vytvorí kind=wiki hrany z [[odkazov]]. Cieľ sa rieši podľa labelu
     * (case-insensitive) alebo slug-u. Idempotentné: existujúca hrana sa len
     * (voliteľne) povýši na kind=wiki, váha sa NEinkrementuje.
     *
     * @param  array<int, list<string>>  $wikiByNode
     * @param  array<string, int>  $stats
     */
    private function syncWikiEdges(array $wikiByNode, array &$stats, bool $emit): void
    {
        // mapa label(lower)→id a slug→id nad všetkými uzlami (aj cieľmi mimo brain)
        $labelMap = [];
        $slugMap = [];
        foreach (Node::query()->get(['id', 'label']) as $n) {
            $labelMap[mb_strtolower(trim($n->label))] = $n->id;
            $slugMap[Str::slug($n->label)] = $n->id;
        }

        foreach ($wikiByNode as $sourceId => $links) {
            foreach ($links as $link) {
                $target = $labelMap[mb_strtolower(trim($link))]
                    ?? $slugMap[Str::slug($link)]
                    ?? null;

                if ($target === null || $target === $sourceId) {
                    continue; // nerozpoznaný odkaz — ticho preskoč, nikdy neblokuj import
                }

                if ($this->wikiEdge($sourceId, $target, $emit)) {
                    $stats['edges_created']++;
                }
            }
        }
    }

    /**
     * Jedna wiki hrana (undirected, source_id<target_id). Vráti true ak vznikla.
     */
    private function wikiEdge(int $aId, int $bId, bool $emit): bool
    {
        [$s, $t] = $aId < $bId ? [$aId, $bId] : [$bId, $aId];

        $edge = Edge::where('source_id', $s)->where('target_id', $t)->first();
        if ($edge) {
            // len povýš význam na wiki, ak je slabší; VÁHU NEMEŇ (idempotencia)
            if ((self::KIND_RANK[$edge->kind] ?? 0) < self::KIND_RANK['wiki']) {
                $edge->forceFill(['kind' => 'wiki'])->save();
            }

            return false;
        }

        $edge = Edge::create([
            'source_id' => $s,
            'target_id' => $t,
            'weight' => 1,
            'kind' => 'wiki',
            'auto' => true,
            'last_activated_at' => now(),
        ]);

        if ($emit) {
            MindPulse::dispatch('edge.created', ['edge' => $edge->toApi()]);
        }

        return true;
    }

    /**
     * R7 — brain uzly v synchronizovanom scope, ktorých external_key sa v behu
     * NEobjavil (súbor zmizol) → needs_review=true. NEMAŽE (história ostáva).
     *
     * @param  list<array<string, mixed>>  $sources
     * @param  array<string, bool>  $seenKeys
     * @param  array<string, int>  $stats
     */
    private function flagMissing(array $sources, array $seenKeys, array &$stats): void
    {
        $prefixes = array_values(array_unique(array_map(
            fn ($s) => $this->registry->keyPrefix($s),
            $sources,
        )));
        if ($prefixes === []) {
            return;
        }

        $query = Node::query()
            ->where('origin', 'brain')
            ->where('needs_review', false)
            ->where(function ($q) use ($prefixes) {
                foreach ($prefixes as $p) {
                    $q->orWhere('external_key', 'like', $p.'%');
                }
            });

        foreach ($query->get() as $node) {
            if (isset($seenKeys[$node->external_key])) {
                continue;
            }
            $node->forceFill(['needs_review' => true])->save();
            $stats['flagged_missing']++;
        }
    }

    /**
     * Zapíše/aktualizuje záznam zdroja v brain_sources (last_synced_at).
     *
     * @param  list<array<string, mixed>>  $sources
     */
    private function recordSources(array $sources): void
    {
        foreach ($sources as $s) {
            BrainSource::updateOrCreate(
                ['key' => $s['key']],
                [
                    'type' => $s['type'],
                    'label' => $s['label'] ?? null,
                    'path' => $s['path'] ?? null,
                    'enabled' => (bool) ($s['enabled'] ?? true),
                    'writable' => (bool) ($s['writable'] ?? false),
                    'last_synced_at' => now(),
                ],
            );
        }
    }

    private function areaId(?string $slug): ?int
    {
        if ($slug === null || $slug === '') {
            return null;
        }
        if (! array_key_exists($slug, $this->areaCache)) {
            $this->areaCache[$slug] = Area::where('slug', $slug)->value('id');
        }

        return $this->areaCache[$slug];
    }

    private function deptId(?int $areaId, string $name): ?int
    {
        if ($areaId === null) {
            return null;
        }
        $slug = Str::slug($name);
        $ck = $areaId.':'.$slug;
        if (! array_key_exists($ck, $this->deptCache)) {
            $this->deptCache[$ck] = Department::firstOrCreate(
                ['area_id' => $areaId, 'slug' => $slug],
                ['name' => $name],
            )->id;
        }

        return $this->deptCache[$ck];
    }
}
