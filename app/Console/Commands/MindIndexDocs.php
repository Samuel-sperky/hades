<?php

namespace App\Console\Commands;

use App\Models\Area;
use App\Models\BrainSource;
use App\Models\Node;
use App\Models\SyncRun;
use App\Models\Tag;
use App\Models\Tombstone;
use App\Services\Brain\BrainFileParser;
use App\Services\Brain\BrainNode;
use App\Services\Brain\Frontmatter;
use App\Services\Brain\SecretScanner;
use App\Services\Console\Roots;
use App\Services\MindService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Indexuje lokálne dokumenty z pomenovaných koreňov ({@see Roots}) do pamäte —
 * jeden súbor = jeden uzol, `origin=brain`, `source=local-doc`.
 *
 * Kontrakt §3 „Lokálne dáta". Príkaz je **zároveň sledovanie zmien**: pustí sa
 * schedulerom každých pár minút a zmeny nájde porovnaním `content_hash`.
 *
 * Prečo NIE watcher (inotify démon): PHP workerov je osem a démon by jedného
 * z nich držal navždy — presne to, čo dvojfázová brána Charóna nesmie dovoliť
 * ani zaparkovanému zápisu. Navyše by pri smrti procesu prestal sledovať a nikto
 * by to nevedel, kým sa niekto nespýta na dokument, ktorý sa neaktualizoval.
 * Periodický príkaz je pozorovateľný (`sync_runs`), prerušiteľný a bez stavu
 * v pamäti procesu.
 *
 * Čo tento príkaz NEROBÍ (a čo za neho robí niekto, kto to už robí):
 *   - **nevektorizuje** — `--embed` na konci zavolá `mind:embed --stale`,
 *   - **neklasifikuje odpad** — `MindService::noiseOf()` je jediný klasifikátor,
 *   - **neparsuje `.md`** — `BrainFileParser` je jediný parser mozgov.
 *
 * Inkrementálnosť: `external_key` (relatívna cesta) je identita uzla,
 * `content_hash` je odtlačok obsahu. Nezmenený súbor je `skipped`, zmenený
 * `updated`, nový `created`. Beh nemá jednu veľkú transakciu, takže Ctrl-C prácu
 * zastaví a nezruší — ďalší beh pokračuje tam, kde sa skončilo.
 *
 * Zámok je zdieľaný s `mind:brain-sync` (`Cache::lock('brain-sync')`) zámerne:
 * oba zapisujú uzly s UNIQUE `content_hash`, takže dva súbežné pisatelia by na
 * ňom kolidovali v databáze namiesto toho, aby sa dohodli v aplikácii.
 */
class MindIndexDocs extends Command
{
    protected $signature = 'mind:index-docs
        {--root= : Indexovať len jeden koreň (meno z hades.console.roots)}
        {--limit= : Spracovať najviac N súborov na koreň (zvyšok zostane na ďalší beh)}
        {--dry-run : Nič nezapíše — spočíta zmeny a rollbackne}
        {--embed : Po behu dovektorizovať zmenené uzly (mind:embed --stale)}';

    protected $description = 'Indexuje lokálne dokumenty z pomenovaných koreňov do pamäte (origin=brain)';

    /** @var array<string, ?int> slug oblasti → id */
    private array $areaCache = [];

    public function handle(
        Roots $roots,
        MindService $mind,
        BrainFileParser $parser,
        SecretScanner $scanner,
    ): int {
        $only = $this->option('root') ?: null;
        $dryRun = (bool) $this->option('dry-run');
        $limit = (int) $this->option('limit');

        // Koreň, ktorý config popisuje a Roots ho zahodil, musí byť VIDITEĽNÝ.
        // Ticho chýbajúci koreň sa hľadá hodinu a vypadá ako chyba indexovania.
        foreach ($roots->rejected() as $name => $reason) {
            $this->warn("Koreň `{$name}` sa nepoužije: {$reason}");
        }

        if ($only !== null && $roots->byName($only) === null) {
            $this->error("Koreň `{$only}` neexistuje. Známe korene: ".implode(', ', $roots->names()));

            return self::FAILURE;
        }

        $targets = $roots->indexable($only);

        if ($targets === []) {
            $hint = 'Zapína to kľúč index => true v hades.console.roots.';

            $this->info($only !== null
                ? "Koreň `{$only}` nie je označený na indexovanie. ".$hint
                : 'Žiadny koreň nie je označený na indexovanie. '.$hint);

            return self::SUCCESS;
        }

        $lock = Cache::lock('brain-sync', 600);

        if (! $lock->get()) {
            $this->error('Zámok brain-sync je obsadený — indexovanie alebo brain-sync práve beží.');

            return self::FAILURE;
        }

        try {
            return $this->index($targets, $roots, $mind, $parser, $scanner, $dryRun, $limit, $only);
        } finally {
            $lock->release();
        }
    }

    /**
     * @param  list<array<string, mixed>>  $targets
     */
    private function index(
        array $targets,
        Roots $roots,
        MindService $mind,
        BrainFileParser $parser,
        SecretScanner $scanner,
        bool $dryRun,
        int $limit,
        ?string $only,
    ): int {
        $this->areaCache = [];

        $stats = [
            'files' => 0,           // videných súborov
            'created' => 0,
            'updated' => 0,
            'skipped' => 0,         // nezmenený obsah
            'skipped_noise' => 0,   // MindService::noiseOf() → odpad
            'skipped_secret' => 0,  // SecretScanner našiel vzor tajomstva
            'skipped_mirror' => 0,  // Hadesov vlastný export (frontmatter node_id)
            'skipped_dup_hash' => 0,
            'skipped_big' => 0,     // nad hades.local_index.max_bytes
            'skipped_empty' => 0,
            'unreadable' => 0,
            'flagged_missing' => 0,
            'roots' => count($targets),
        ];

        $run = $dryRun ? null : SyncRun::create([
            'source' => $only !== null ? 'root:'.$only : 'roots',
            'started_at' => now(),
        ]);

        if ($dryRun) {
            DB::beginTransaction();
        }

        $maxBytes = max(1, (int) config('hades.local_index.max_bytes', 512000));
        $noise = [];
        $secrets = [];

        try {
            foreach ($targets as $root) {
                $descriptors = $roots->files($root);
                $seen = [];

                // `--limit` znamená, že zvyšok koreňa NIE JE prejdený. Neúplný
                // prechod nesmie nikoho označiť za zmiznutého ani tvrdiť, že
                // koreň je zosynchronizovaný.
                $complete = $limit <= 0 || count($descriptors) <= $limit;

                if (! $complete) {
                    $descriptors = array_slice($descriptors, 0, $limit);
                }

                foreach ($descriptors as $descriptor) {
                    $stats['files']++;

                    if ($descriptor['size'] > $maxBytes) {
                        $stats['skipped_big']++;

                        continue;
                    }

                    $raw = @file_get_contents($descriptor['abs_path']);

                    if ($raw === false) {
                        // Súbor zmizol medzi enumeráciou a čítaním, alebo naň
                        // nemáme práva. Nie je to dôvod zhodiť beh, ale nesmie
                        // to ani spustiť „súbor zmizol" — o tom nič nevieme.
                        $stats['unreadable']++;
                        $complete = false;

                        continue;
                    }

                    if (trim($raw) === '') {
                        $stats['skipped_empty']++;
                        $seen[$descriptor['external_key']] = true;

                        continue;
                    }

                    // Mirror-guard: súbor, ktorý vyrobil Hades sám (export do
                    // `.md`), sa nesmie zaindexovať späť — inak export a index
                    // krúžia dokola.
                    $frontmatter = Frontmatter::parse($raw);

                    if (isset($frontmatter['node_id']) || ($frontmatter['source'] ?? null) === 'hades') {
                        $stats['skipped_mirror']++;
                        $seen[$descriptor['external_key']] = true;

                        continue;
                    }

                    if (Tombstone::where('external_key', $descriptor['external_key'])->exists()) {
                        // Pohltený kľúč sa nesmie vrátiť. `seen` zámerne NIE —
                        // uzol pre tento kľúč už neexistuje.
                        continue;
                    }

                    $brainNode = $parser->parse($raw, $descriptor);

                    // Klasifikátor odpadu je jeden a je v MindService. Uzol sa
                    // ešte neukládá — noiseOf() číta len label a popis.
                    $code = $mind->noiseOf(new Node([
                        'label' => $brainNode->label,
                        'description' => $brainNode->description,
                    ]));

                    if ($code !== null) {
                        $stats['skipped_noise']++;
                        $noise[] = "{$descriptor['rel_path']} ({$code})";
                        $seen[$descriptor['external_key']] = true;

                        continue;
                    }

                    // Skenuje sa PRESNE to, čo sa ukladá — label a popis. Celý
                    // súbor by pri `long-hex` odmietol každý dokument, ktorý
                    // cituje commit sha; a to, čo v uzle nie je, sa recallom ani
                    // MCP nedostane von.
                    if ($scanner->looksLikeSecret($brainNode->label."\n".(string) $brainNode->description)) {
                        $stats['skipped_secret']++;
                        $secrets[] = $descriptor['rel_path'];
                        $seen[$descriptor['external_key']] = true;

                        continue;
                    }

                    $seen[$descriptor['external_key']] = true;

                    $this->upsert($brainNode, $stats);
                }

                if (! $dryRun) {
                    if ($complete) {
                        $stats['flagged_missing'] += $this->flagMissing($roots->keyPrefix($root), $seen);
                    }

                    $this->recordSource($root, $complete);
                }
            }

            if ($dryRun) {
                DB::rollBack();
            } else {
                $run?->update([
                    'finished_at' => now(),
                    'status' => 'ok',
                    'stats' => $stats,
                ]);
            }
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

        $this->report($stats, $noise, $secrets, $dryRun);

        if ($this->option('embed') && ! $dryRun && ($stats['created'] + $stats['updated']) > 0) {
            $this->newLine();
            $this->line('Dovektorizovanie zmenených uzlov (mind:embed --stale):');
            $this->call('mind:embed', ['--stale' => true]);
        }

        return self::SUCCESS;
    }

    /**
     * `updateOrCreate` uzla podľa `external_key`.
     *
     * `strength`, `pinned`, `verified_at` a `needs_review` sa NIKDY neresetujú —
     * sila je história aktivácií, nie vlastnosť súboru. Tá istá podmienka ako
     * v `BrainSyncService::upsert()`.
     *
     * @param  array<string, int>  $stats
     */
    private function upsert(BrainNode $brainNode, array &$stats): void
    {
        $existing = Node::where('external_key', $brainNode->externalKey)->first();

        // `content_hash` je UNIQUE. Dva súbory s tým istým obsahom (kópia
        // dokumentu v druhom priečinku) majú byť JEDEN uzol, nie kolízia v DB.
        $clash = Node::where('content_hash', $brainNode->contentHash)
            ->when($existing !== null, fn ($q) => $q->where('id', '!=', $existing->id))
            ->when($existing === null, fn ($q) => $q->where('external_key', '!=', $brainNode->externalKey))
            ->exists();

        if ($clash) {
            $stats['skipped_dup_hash']++;

            return;
        }

        $payload = [
            'type' => $brainNode->type,
            'source' => $brainNode->source,
            'origin' => 'brain',
            'area_id' => $this->areaId($brainNode->areaSlug),
            'label' => $brainNode->label,
            'description' => $brainNode->description,
            'certainty' => $brainNode->certainty,
            'source_file' => $brainNode->sourceFile,
            'content_hash' => $brainNode->contentHash,
            'meta' => $brainNode->meta,
        ];

        if ($existing === null) {
            $node = Node::create([
                'external_key' => $brainNode->externalKey,
                'needs_review' => $brainNode->needsReview,
                'strength' => 1,
                'last_activated_at' => now(),
                ...$payload,
            ]);

            $this->syncTags($node, $brainNode->tags);
            $stats['created']++;

            return;
        }

        $existing->fill($payload);

        if ($existing->isDirty()) {
            $existing->last_activated_at = now();
            $existing->save();
            $stats['updated']++;
        } else {
            $stats['skipped']++;
        }

        $this->syncTags($existing, $brainNode->tags);
    }

    /**
     * Tagy sa pripájajú ADITÍVNE — ručne pridaný tag nesmie zmiznúť len preto,
     * že ho súbor nemá vo frontmatteri.
     *
     * @param  list<string>  $tags
     */
    private function syncTags(Node $node, array $tags): void
    {
        $ids = [];

        foreach ($tags as $name) {
            if ($tag = Tag::forName((string) $name)) {
                $ids[] = $tag->id;
            }
        }

        if ($ids !== []) {
            $node->tags()->syncWithoutDetaching($ids);
        }
    }

    /**
     * Uzly koreňa, ktorých súbor sa v tomto behu neobjavil → `needs_review`.
     *
     * NEMAŽE. Zmiznutý súbor môže byť premenovaný, presunutý alebo odmountovaný
     * priečinok; zmazať uzol by znamenalo zabudnúť poznatok kvôli chybe mountu.
     *
     * @param  array<string, bool>  $seen
     */
    private function flagMissing(string $prefix, array $seen): int
    {
        $flagged = 0;

        $nodes = Node::query()
            ->where('origin', 'brain')
            ->where('needs_review', false)
            ->where('external_key', 'like', $prefix.'%')
            ->get();

        foreach ($nodes as $node) {
            if (isset($seen[$node->external_key])) {
                continue;
            }

            $node->forceFill(['needs_review' => true])->save();
            $flagged++;
        }

        return $flagged;
    }

    /**
     * Stav sledovania v DB — jeden riadok na koreň v `brain_sources`.
     *
     * `last_synced_at` sa nastavuje LEN po úplnom prechode. Po behu s `--limit`
     * (alebo po nečitateľnom súbore) by to bola lož o tom, že koreň je celý
     * prejdený.
     *
     * @param  array<string, mixed>  $root
     */
    private function recordSource(array $root, bool $complete): void
    {
        $attributes = [
            'type' => 'local-root',
            'label' => $root['label'],
            'path' => $root['path'],
            'enabled' => true,
            'writable' => $root['writable'],
        ];

        if ($complete) {
            $attributes['last_synced_at'] = now();
        }

        BrainSource::updateOrCreate(['key' => 'root:'.$root['name']], $attributes);
    }

    /**
     * @param  array<string, int>  $stats
     * @param  list<string>  $noise
     * @param  list<string>  $secrets
     */
    private function report(array $stats, array $noise, array $secrets, bool $dryRun): void
    {
        $this->info(($dryRun ? '[DRY-RUN] ' : '')."Indexovanie dokončené — {$stats['roots']} koreň(ov), {$stats['files']} súborov.");

        $this->table(
            ['created', 'updated', 'skipped', 'noise', 'secret', 'mirror', 'dup_hash', 'big', 'empty', 'unreadable', 'missing'],
            [[
                $stats['created'], $stats['updated'], $stats['skipped'], $stats['skipped_noise'],
                $stats['skipped_secret'], $stats['skipped_mirror'], $stats['skipped_dup_hash'],
                $stats['skipped_big'], $stats['skipped_empty'], $stats['unreadable'], $stats['flagged_missing'],
            ]],
        );

        // Preskočený súbor musí byť dohľadateľný — inak sa „prečo tam ten
        // dokument nie je" nedá zodpovedať bez čítania kódu.
        foreach ([['odpad (noiseOf)', $noise], ['vzor tajomstva', $secrets]] as [$title, $list]) {
            if ($list === []) {
                continue;
            }

            $this->newLine();
            $this->line("Preskočené — {$title} (prvých 5 z ".count($list).'):');

            foreach (array_slice($list, 0, 5) as $item) {
                $this->line("  {$item}");
            }
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
}
