<?php

namespace App\Serializers\Screen;

use App\Models\Node;
use App\Serializers\ScreenSerializer;
use App\Support\ProjectGroup;
use Illuminate\Database\Eloquent\Builder;

/**
 * Obrazovka Denník — chronológia toho, čo vedomie prežilo.
 *
 * Jeden zdroj pre `GET /api/journal` (človek) aj pre `mind_journal` (AI). Pre AI
 * je to jediná cesta k času: `mind_recall` vracia poznatky, nie ich poradie.
 *
 * Dva rozchody plôch, ktoré audit dokázal a ktoré táto trieda zabíja:
 *
 *  1. **Počty projektov si počítal prehliadač z 50 načítaných záznamov**
 *     (`dennik.js:63–69`), hoci korpus má stovky. Čip preto tvrdil „AI-mind 12",
 *     kým v denníku bolo záznamov násobne viac — a AI, ktorá čítala serverové
 *     `projects{}`, videla tretie číslo. Počty teraz robí server nad **celým**
 *     korpusom a `filtered_total` povie, koľko z nich filter zachytil, takže okno
 *     `limit` nikdy nevydáva časť za celok.
 *  2. **Skupina „bez projektu" bola klientska heuristika** (`dennik.js:47–50` +
 *     `util.js:354`). Človek videl jeden čip, AI dvanásť strojových názvov
 *     adresárov. Skupinu tvorí {@see ProjectGroup} na serveri a jej kľúč sa dá
 *     poslať späť ako filter — čo `null` nedokázalo.
 *
 * Kľúč `projects` (surová mapa „názov → počet" nad `source=session`) v odpovedi
 * **zostáva nezmenený**: je to verejný tvar endpointu a jeho stratou by sa payload
 * rozišiel s klientmi, o ktorých neviem. Zdrojom pravdy pre obrazovku aj pre AI je
 * `project_groups` — a to je jediné, čo `fieldsForAi()` menuje, aby sa nikdy
 * nestalo, že si každá plocha vyberie inú mapu.
 *
 * **Stránkovanie je `offset`, nie cursor — a je to rozhodnutie, nie lenivosť.**
 * Do 1. 9. 2026 endpoint hlásil `total: 153` a poslal 50 záznamov, ku zvyšným 103
 * nevedla žiadna cesta. Zvolený je offset preto, že:
 *
 *  1. **Odpoveď už nesie `filtered_total`.** Offset je jediné stránkovanie, ktoré
 *     sa s tým číslom dá zladiť („51–100 z 153"); cursor vie povedať len „ďalších
 *     50" a pozíciu v celku nie. Repo má vlastné pravidlo, že rez, ktorý sa
 *     nepriznáva, je lož — a priznať sa dá len tam, kde je pozícia známa.
 *  2. **Denník rastie NAHORE a jeho riadky sa nemenia.** Nový záznam vloží na
 *     začiatok, takže okno na `offset=50` sa posunie o jeden riadok *dozadu* —
 *     hraničný záznam sa raz zobrazí dvakrát. Cursor by chránil pred stratou
 *     riadka, ale strata je opačný smer a tu nastať nemôže: nič sa nevkladá
 *     doprostred a nič sa nemaže.
 *  3. Cursor by potreboval zložený kľúč `(created_at, id)` — dve hodnoty v URL,
 *     ktoré sa navyše zahodia pri každej zmene filtra.
 *
 * Druhý kľúč radenia (`id DESC`) je aj tak povinný a je vysvetlený pri dopyte.
 */
class DennikScreen extends ScreenSerializer
{
    /** Strop okna. Denník je časová os, nie export — starší záznam sa hľadá filtrom. */
    public const MAX_LIMIT = 50;

    /** Zdroje uzlov, ktoré sú „záznam zo session". */
    private const SOURCES = ['session', 'digest'];

    /** @var \Illuminate\Support\Collection<int, object>|null */
    private ?\Illuminate\Support\Collection $groupRows = null;

    /**
     * @param  array<string, mixed>  $filters  project (kľúč skupiny), q, offset, limit
     */
    public function __construct(private array $filters = []) {}

    public function data(): array
    {
        $limit = max(1, min((int) ($this->filters['limit'] ?? self::MAX_LIMIT), self::MAX_LIMIT));
        $offset = max(0, (int) ($this->filters['offset'] ?? 0));
        $project = trim((string) ($this->filters['project'] ?? ''));
        $q = self::text($this->filters['q'] ?? null);

        $query = $this->scope();

        if ($project !== '') {
            $this->applyProject($query, $project);
        }

        if ($q !== '') {
            $this->applySearch($query, $q);
        }

        $records = (clone $query)
            // Druhý kľúč radenia je podmienka stránkovania, nie kozmetika:
            // `created_at` nie je unikátny (dva záznamy jednej sekundy sú reálne)
            // a bez rozlíšenia by MySQL mohol dať tomu istému riadku iné miesto
            // v dvoch po sebe idúcich oknách — teda ho raz zdvojiť a raz vynechať.
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->offset($offset)
            ->limit($limit)
            ->get()
            ->map(fn (Node $n): array => $this->row($n))
            ->all();

        return [
            'records' => $records,
            // Surová mapa — pôvodný tvar endpointu, zámerne nedotknutá. Pravda
            // pre obrazovku aj AI je `project_groups`.
            'projects' => $this->rawProjects(),
            'project_groups' => $this->projectGroups(),
            'total' => $this->scope()->count(),
            // Počet PO filtri (projekt aj `q`) — nad tým istým builderom, z ktorého
            // sa berie okno. Keby sa počítal nad `scope()`, „ďalších 50" by pri
            // filtri sľubovalo číslo, ktoré zoznam nikdy nedá.
            'filtered_total' => $query->count(),
            'project' => $project === '' ? null : $project,
            'q' => $q === '' ? null : $q,
            'offset' => $offset,
            'limit' => $limit,
        ];
    }

    public function fieldsForAi(): array
    {
        return [
            'total', 'filtered_total', 'project', 'q', 'offset', 'limit',
            'project_groups[].key', 'project_groups[].label', 'project_groups[].count',
            'records[].id', 'records[].source', 'records[].label', 'records[].project_key',
            'records[].created_at', 'records[].prompt_count', 'records[].file_count',
            'records[].commit_count',
        ];
    }

    /**
     * Jeden záznam.
     *
     * `project` je surová hodnota z `meta` (identita záznamu, kompatibilita),
     * `project_key` je skupina, ktorou sa filtruje, `project_label` je to, čo číta
     * človek. Bez tej trojice by si každá plocha musela dopočítať dve z nich sama —
     * a presne to sa stalo.
     *
     * @return array<string, mixed>
     */
    private function row(Node $node): array
    {
        $meta = is_array($node->meta) ? $node->meta : [];
        $project = $meta['project'] ?? null;
        $commits = is_array($meta['commits'] ?? null) ? $meta['commits'] : [];

        return [
            'id' => $node->id,
            'source' => $node->source,
            'label' => $node->label,
            'description' => $node->description,
            'project' => $project,
            'project_key' => ProjectGroup::key($project),
            'project_label' => ProjectGroup::label($project),
            'created_at' => $node->created_at?->toIso8601String(),
            'prompt_count' => $meta['prompt_count'] ?? null,
            'file_count' => $meta['file_count'] ?? null,
            // Počet commitov počítal prehliadač z pola (`dennik.js:139`). Je to
            // údaj, nie kresba, takže ho dáva server — a AI dostane číslo namiesto
            // celého zoznamu, ktorý na obrazovke nikto nevidí.
            'commit_count' => count($commits),
            'commits' => $commits,
            'files' => $meta['files'] ?? [],
            'tools' => $meta['tools'] ?? [],
            'prompts' => $meta['prompts'] ?? [],
            'final' => $meta['final'] ?? null,
        ];
    }

    /**
     * Skupiny projektov nad CELÝM korpusom denníka (nie nad oknom `limit`) a nad
     * tými istými zdrojmi, z ktorých sú záznamy — inak by čip sľuboval počet,
     * ktorý sa po kliknutí nedá naplniť.
     *
     * Zoradenie je súčasťou odpovede: obrazovka kreslí prvých osem a keby radil
     * klient, boli by to iných osem než tie, o ktorých AI hovorí.
     *
     * @return list<array{key: string, label: string, count: int}>
     */
    private function projectGroups(): array
    {
        $groups = [];

        foreach ($this->groupRows() as $row) {
            $key = ProjectGroup::key($row->project);
            $groups[$key] = ($groups[$key] ?? 0) + (int) $row->c;
        }

        uksort($groups, fn (string $a, string $b): int => ($groups[$b] <=> $groups[$a]) ?: strcmp($a, $b));

        $out = [];

        foreach ($groups as $key => $count) {
            $out[] = ['key' => $key, 'label' => ProjectGroup::label($key), 'count' => $count];
        }

        return $out;
    }

    /**
     * Pôvodná mapa „projekt → počet" nad `source=session`. Ostáva bit za bitom
     * taká, aká bola, vrátane `COALESCE(…, 'projekt')` a strojových názvov.
     *
     * @return array<string, int>
     */
    private function rawProjects(): array
    {
        return Node::where('source', 'session')
            ->selectRaw("COALESCE(".ProjectGroup::column().", 'projekt') as project, COUNT(*) as c")
            ->groupBy('project')
            ->orderByDesc('c')
            ->get()
            ->mapWithKeys(fn ($row): array => [$row->project => (int) $row->c])
            ->all();
    }

    /**
     * Hľadanie v zázname — label a popis.
     *
     * `LOWER(...) LIKE`, **nie** `COLLATE utf8mb4_unicode_ci`: ten je MariaDB-only
     * a obrazovka Smernica na ňom stojí, preto ju `ScreenParityTest` na sqlite
     * preskakuje. Denník sa preskakovať nemá, takže tu ide o ten istý kompromis,
     * aký si zvolil `ChatScreen::base()` — bez akcentovej necitlivosti, ale merateľný
     * na oboch ovládačoch DB.
     *
     * Prečo to musí byť na serveri: klient má okno `limit`, takže „hľadanie" nad ním
     * by prehľadávalo 50 zo 153 záznamov a hlásilo prázdny výsledok tam, kde záznam
     * existuje. To nie je pomalé hľadanie, to je nesprávna odpoveď.
     *
     * @param  Builder<Node>  $query
     */
    private function applySearch(Builder $query, string $q): void
    {
        $needle = '%'.mb_strtolower($q).'%';

        $query->where(function (Builder $inner) use ($needle): void {
            $inner->whereRaw('LOWER(label) LIKE ?', [$needle])
                ->orWhereRaw('LOWER(description) LIKE ?', [$needle]);
        });
    }

    /**
     * Filter ako text, alebo prázdno. Ten istý dôvod ako v {@see RunsScreen::text()}:
     * MCP tool posiela argumenty tak, ako ich napísal model, takže tu môže pristáť
     * pole aj objekt a `(string) []` by bolo varovanie.
     */
    private static function text(mixed $value): string
    {
        return is_scalar($value) ? trim((string) $value) : '';
    }

    /**
     * Filtrovanie skupinou.
     *
     * Sentinel „bez projektu" nie je hodnota v DB, ale trieda hodnôt: prázdny
     * projekt **a** každý strojový názov adresára. Zoznam strojových názvov sa
     * preto vyberie z agregátu a klasifikuje v PHP tým istým pravidlom, ktorým sa
     * počítajú skupiny. Preložiť ten regulárny výraz do SQL by znamenalo mať ho
     * dvakrát — a dve kópie jedného pravidla sú presne to, čo vlna E lieči.
     *
     * @param  Builder<Node>  $query
     */
    private function applyProject(Builder $query, string $project): void
    {
        if ($project !== ProjectGroup::NONE) {
            $query->where('meta->project', $project);

            return;
        }

        $machine = [];

        foreach ($this->groupRows() as $row) {
            if ($row->project !== null && ProjectGroup::isMachineName($row->project)) {
                $machine[] = $row->project;
            }
        }

        $query->where(function (Builder $q) use ($machine): void {
            $q->whereNull('meta->project');

            if ($machine !== []) {
                $q->orWhereIn('meta->project', $machine);
            }
        });
    }

    /**
     * Agregát „projekt → počet" nad celým denníkom, surový. Volá sa dvakrát
     * (skupiny + filter sentinelom), preto sa výsledok drží.
     *
     * @return \Illuminate\Support\Collection<int, object>
     */
    private function groupRows(): \Illuminate\Support\Collection
    {
        // `toBase()` zámerne: sú to dva agregované stĺpce, nie uzly. Ako model by
        // sa im pripájali casty a mutátory Node, ktoré tu nemajú čo robiť.
        return $this->groupRows ??= $this->scope()
            ->selectRaw(ProjectGroup::column().' as project, COUNT(*) as c')
            ->groupBy('project')
            ->toBase()
            ->get();
    }

    /**
     * @return Builder<Node>
     */
    private function scope(): Builder
    {
        return Node::query()->whereIn('source', self::SOURCES);
    }
}
