<?php

namespace App\Serializers\Screen;

use App\Http\Controllers\Api\StatsController;
use App\Models\Node;
use App\Serializers\ScreenSerializer;
use App\Support\ProjectGroup;
use Illuminate\Support\Str;

/**
 * Obrazovka Dnes — prehľad, ktorým sa vedomie predstaví.
 *
 * Jeden zdroj pre `GET /api/today` (človek) aj pre `mind_today` (AI).
 *
 * **Prečo je tu aj dashboardový agregát.** Obrazovka Dnes stála na DVOCH
 * volaniach — `/api/today` (ľahké zoznamy) a `/api/dashboard` (ťažké agregáty).
 * Pre dvojitú plochu to nie je udržateľné: MCP tool je jedno volanie, takže by
 * si AI plochu skladala z dvoch endpointov po svojom a rozdiel medzi „čo vidí
 * človek" a „čo dostane AI" by bol znova dohad. `data()` preto vracia **celú
 * obrazovku** a prehliadač si vystačí s jedným volaním. `/api/dashboard` žije
 * ďalej nezmenené — má externý mirror `/api/v1/stats`.
 *
 * Agregát sa **nekopíruje**, číta sa z {@see StatsController::dashboard()}.
 * Presunúť ho do služby by bolo čistejšie, ale ten kontrolér drží tvar
 * `/api/v1/*`, ktorý sa v tomto šprinte nesmie hýbať — a druhá kópia tých istých
 * agregátov je presne tá chyba, ktorú celá vlna E lieči.
 *
 * Čo sa sem prenieslo z prehliadača (audit 19. 8. 2026):
 *   - **strop zoznamu sessions** (`dnes.js:85` posielalo 8, kreslilo 6 — AI teda
 *     videla dve session, ktoré na obrazovke neboli),
 *   - **skupina „bez projektu"** v aktívnych projektoch (strojové názvy adresárov
 *     dávali rad jednopočetných čipov s tým istým popiskom),
 *   - **stav synchronizácie** (`dnes.js:239–241`: neznámy stav sa v prehliadači
 *     mlčky prekresľoval na „v poriadku" a príznak zápisu do playbookov sa čítal
 *     raz z jedného, raz z druhého kľúča),
 *   - **markdown v úryvku** (`dnes.js:354`: človek videl čistý text, AI „**Čo:** …").
 *
 * Čo v prehliadači zámerne **zostáva**: škálovanie barov per oblasť
 * (`dnes.js:224` — pomer k najvyššej hodnote je šírka v pixeloch, nie údaj),
 * slovenské plurály, `timeAgo`, farby oblastí a mapovanie stavu na slovo.
 */
class DnesScreen extends ScreenSerializer
{
    /** Karty „Naposledy si robil na…" — koľko ich obrazovka naozaj nakreslí. */
    public const RECENT_SESSIONS = 6;

    /** Riadky „Posledné záznamy". */
    public const RECENT_RECORDS = 6;

    /** Čipy „Aktívne projekty" — po zoskupení, nie pred ním. */
    public const TOP_PROJECTS = 6;

    /** Dĺžka úryvku záznamu. */
    public const SNIPPET = 140;

    /** Zdroje uzlov, ktoré sú „záznam zo session". */
    private const SOURCES = ['session', 'digest'];

    /** Stavy synchronizácie, ktoré appka pozná. */
    private const SYNC_STATES = ['ok', 'partial', 'error', 'running'];

    public function __construct(private ?StatsController $stats = null) {}

    public function data(): array
    {
        $weekAgo = now()->subDays(7);
        $dash = ($this->stats ?? app(StatsController::class))->dashboard();

        return [
            // ---- ľahké zoznamy (pôvodné /api/today) ------------------------
            'recent_sessions' => $this->recentSessions(),
            'week_added' => [
                'nodes' => Node::where('created_at', '>=', $weekAgo)->count(),
                'sessions' => Node::where('created_at', '>=', $weekAgo)
                    ->whereIn('source', self::SOURCES)->count(),
            ],
            'top_projects' => $this->topProjects(),
            'recent_records' => $this->recentRecords(),

            // ---- agregáty (tie isté kľúče ako /api/dashboard) --------------
            'counts' => $dash['counts'],
            'certainty' => $dash['certainty'],
            'per_area' => $dash['per_area'],
            'growth' => $dash['growth'],
            'heatmap' => $dash['heatmap'],
            'sync' => $this->sync($dash),
            'brain_write_enabled' => $dash['brain_write_enabled'],
        ];
    }

    /**
     * `heatmap` v zozname pre AI **nie je** a je to rozhodnutie, nie opomenutie:
     * je to 365 buniek, teda najdrahšia časť odpovede, a nesie dojem z mriežky,
     * nie fakt. Ročný súčet aktivít nesie `counts`/`certainty` kontext dosť.
     */
    public function fieldsForAi(): array
    {
        return [
            'week_added', 'counts', 'certainty', 'growth', 'sync', 'brain_write_enabled',
            'per_area[].slug', 'per_area[].name', 'per_area[].count',
            'per_area[].overene', 'per_area[].hypoteza', 'per_area[].pasca', 'per_area[].bez',
            'top_projects[].project', 'top_projects[].count',
            'recent_sessions[].id', 'recent_sessions[].label',
            'recent_sessions[].project', 'recent_sessions[].created_at',
            'recent_records[].id', 'recent_records[].label', 'recent_records[].project',
            'recent_records[].snippet', 'recent_records[].created_at',
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function recentSessions(): array
    {
        return Node::whereIn('source', self::SOURCES)
            ->orderByDesc('created_at')
            ->limit(self::RECENT_SESSIONS)
            ->get()
            ->map(fn (Node $n): array => [
                'id' => $n->id,
                'label' => $n->label,
                'source' => $n->source,
                'project' => self::projectOf($n),
                'project_label' => ProjectGroup::label(self::projectOf($n)),
                'created_at' => $n->created_at?->toIso8601String(),
            ])
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function recentRecords(): array
    {
        return Node::whereIn('source', self::SOURCES)
            ->orderByDesc('created_at')
            ->limit(self::RECENT_RECORDS)
            ->get()
            ->map(fn (Node $n): array => [
                'id' => $n->id,
                'label' => $n->label,
                'project' => self::projectOf($n),
                'project_label' => ProjectGroup::label(self::projectOf($n)),
                'snippet' => self::snippet($n->description),
                'created_at' => $n->created_at?->toIso8601String(),
            ])
            ->all();
    }

    /**
     * Aktívne projekty — zoskupené, nie surové.
     *
     * Skupina sa počíta v PHP nad agregátom z DB, pretože rozhodnutie „toto je
     * strojový adresár" je regulárny výraz, ktorý musí byť **jeden** pre server
     * aj pre obrazovku ({@see ProjectGroup}). Zoznam projektov je rádovo desiatky,
     * takže sa nič nešetrí tým, že by to skúšal SQL.
     *
     * Množina zdrojov zostáva `session` (bez `digest`) — nemenil sa význam čísla,
     * len jeho zoskupenie.
     *
     * @return list<array{project: string, label: string, count: int}>
     */
    private function topProjects(): array
    {
        $rows = Node::where('source', 'session')
            ->selectRaw(ProjectGroup::column().' as project, COUNT(*) as c')
            ->groupBy('project')
            ->toBase()
            ->get();

        $groups = [];

        foreach ($rows as $row) {
            $key = ProjectGroup::key($row->project);
            $groups[$key] = ($groups[$key] ?? 0) + (int) $row->c;
        }

        // Poradie je súčasťou odpovede: obrazovka aj AI čítajú prvých šesť a keby
        // radil klient, boli by to iné šesť.
        uksort($groups, fn (string $a, string $b): int => ($groups[$b] <=> $groups[$a]) ?: strcmp($a, $b));

        $out = [];

        foreach (array_slice($groups, 0, self::TOP_PROJECTS, true) as $key => $count) {
            $out[] = [
                'project' => $key,
                'label' => ProjectGroup::label($key),
                'count' => $count,
            ];
        }

        return $out;
    }

    /**
     * Stav synchronizácie s **rozhodnutým** stavom.
     *
     * `status` zostáva taký, aký ho dal `SyncRun` (kompatibilita a pravda o dátach);
     * `state` je normalizovaný stav pre kresbu. Rozdiel je vecný: prehliadač
     * mapoval čokoľvek neznáme aj `null` na `ok`, takže vedomie, ktoré sa nikdy
     * nesynchronizovalo, hlásilo „v poriadku". `none` = nikdy nebežalo,
     * `unknown` = beh skončil stavom, ktorý appka nepozná.
     *
     * @param  array<string, mixed>  $dash
     * @return array<string, mixed>
     */
    private function sync(array $dash): array
    {
        $sync = (array) ($dash['sync'] ?? []);
        $status = $sync['status'] ?? null;

        $sync['state'] = match (true) {
            $status === null || $status === '' => 'none',
            in_array($status, self::SYNC_STATES, true) => (string) $status,
            default => 'unknown',
        };

        // Príznak zápisu do playbookov je v dashboarde na dvoch miestach a
        // prehliadač si vyberal `!= null ? : `. Autoritatívny je koreňový kľúč;
        // tu sa len zrovná, aby si nemal z čoho vyberať.
        $sync['brain_write_enabled'] = (bool) ($dash['brain_write_enabled'] ?? $sync['brain_write_enabled'] ?? false);

        return $sync;
    }

    private static function projectOf(Node $node): ?string
    {
        $meta = $node->meta;

        return is_array($meta) ? ($meta['project'] ?? null) : null;
    }

    /**
     * Úryvok popisu — bez markdownu.
     *
     * Popisy uzlov sú markdown, takže surový úryvok začínal „**Čo:** …". Prehliadač
     * si ho čistil sám (`plainText()`), takže človek videl vetu a AI syntax. Čistí
     * sa PRED skrátením: opačné poradie odsekne text v strede značky a zostane
     * nepárový `**`.
     */
    public static function snippet(?string $description): ?string
    {
        if (($description = (string) $description) === '') {
            return null;
        }

        $plain = preg_replace(
            [
                '/```[a-z]*\n?([\s\S]*?)```/i',  // bloky kódu
                '/`([^`]+)`/',                   // inline kód
                '/!?\[([^\]]*)\]\([^)]*\)/',     // odkazy a obrázky
                '/(\*\*|__)(.*?)\1/s',           // tučné
                '/^\s{0,3}#{1,6}\s+/m',          // nadpisy
                '/^\s{0,3}>\s?/m',               // citácie
                '/\*\*|__|`/',                   // nepárové zvyšky
            ],
            ['$1', '$1', '$1', '$2', '', '', ''],
            $description,
        ) ?? $description;

        $plain = trim(preg_replace('/\s+/u', ' ', $plain) ?? $plain);

        return $plain === '' ? null : Str::limit($plain, self::SNIPPET);
    }
}
