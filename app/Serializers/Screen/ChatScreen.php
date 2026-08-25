<?php

namespace App\Serializers\Screen;

use App\Models\ConsoleBranch;
use App\Models\ConsoleMessage;
use App\Models\ConsoleThread;
use App\Serializers\ScreenSerializer;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Plocha chatu — hľadanie v histórii naprieč vláknami a export vlákna.
 *
 * Jeden zdroj pre `GET /api/console/search` (človek) aj pre MCP tool nad tou
 * istou obrazovkou (AI): endpoint vráti `data()`, tool `forAi()`. Rozdiel medzi
 * plochami je {@see fieldsForAi()}, teda **zoznam kľúčov, nie druhá
 * implementácia**.
 *
 * ## Prečo je export v tej istej triede
 *
 * Hľadanie aj export čítajú tú istú konverzáciu a obe musia z nej vyhodiť to isté
 * (systémovú smernicu) a nikdy neposlať obsah príloh. Keby export žil vedľa,
 * bola by to druhá cesta k tomu istému obsahu — presne to, čo audit 19. 8. 2026
 * našiel šesťkrát. Export je pritom **dokument, nie obrazovka**: skládá sa celý
 * na serveri, aby ho človek aj AI dostali znak po znaku rovnaký, takže mu
 * `data()` / `fieldsForAi()` nesedí a je to statická metóda
 * {@see ChatScreen::markdown()}.
 *
 * ## Dopyt beží na sqlite AJ na MariaDB — zámerne
 *
 * Hľadanie je `LIKE` nad `LOWER(content)`, **nie FULLTEXT a nie `COLLATE`**.
 * Dôvod nie je lenivosť: `MindService::searchNodes()` má natvrdo
 * `COLLATE utf8mb4_unicode_ci`, ktorý sqlite nemá, a preto sa v defaultnej
 * konfigurácii preskočí 45 testov — vrátane celého `HybridRecallTest`. Test, ktorý
 * sa nespustí, vyzerá zelený a nemeria nič. Táto obrazovka preto **nesmie**
 * potrebovať MariaDB a v `ScreenParityTest::registry()` nemá `requires_mariadb`.
 *
 * Čo to stojí, aby to nikto nemusel merať znova:
 *
 *  - **Cena:** `LOWER(content)` je funkcia nad stĺpcom, takže dopyt je plný sken
 *    `console_messages`. Nad rádovo tisícmi správ je to v poriadku; keď tabuľka
 *    narastie o rád, patrí sem FULLTEXT — a s ním pasca z
 *    `2026_08_12_000005_repair_nodes_fulltext_index`: Laravel hlási pre MariaDB
 *    driver `mariadb`, nie `mysql`, takže podmienka len na `'mysql'` index ticho
 *    preskočí.
 *  - **Presnosť:** sqlite `LOWER()` je ASCII-only, MariaDB unicode. Dopyt „VETVA"
 *    teda nájde „vetva" na oboch, ale „VETVENÍ" nenájde „vetvení" na sqlite.
 *    Diakritika sa musí zhodovať na oboch — accent-insensitive hľadanie by
 *    vyžadovalo `COLLATE`, teda presne to, čo tu nechceme.
 *
 * ## Dáta sem, slová do prehliadača
 *
 * Tu sú počty, skupiny, zoradenie, krátenie útržku a kľúč dňa. Popisok
 * „dnes/včera", formát trvania a `timeAgo` sú **slová** a robí ich UI.
 */
class ChatScreen extends ScreenSerializer
{
    /** Strop na jednu stránku výsledkov. */
    public const MAX_LIMIT = 100;

    /** Najkratší dopyt, ktorý má zmysel hľadať. Jednoznakový nájde všetko. */
    public const MIN_QUERY = 2;

    /** Strop na zoznam vlákien v odpovedi. Pravdu o počte nesie `counts.threads`. */
    private const FACET_LIMIT = 50;

    /** Útržok: znakov pred zásahom a za ním. */
    private const SNIPPET_BEFORE = 60;

    private const SNIPPET_AFTER = 140;

    /**
     * Escape znak pre `LIKE`. Nie `\` — a to je portabilita, nie vkus: MySQL
     * v literále `'\\'` vidí jeden backslash, sqlite dva (backslash nespracúva),
     * takže `ESCAPE '\\'` by na jednej z dvoch databáz padlo na „escape musí byť
     * jeden znak". `!` prežije oba parsery bez úprav.
     */
    private const LIKE_ESCAPE = '!';

    /** Strop na argumenty tool callu v exporte. */
    private const EXPORT_ARGS_CAP = 200;

    /**
     * @param  array<string, mixed>  $filters  q, thread, project, role, from, to, limit
     */
    public function __construct(private array $filters = []) {}

    public function data(): array
    {
        $term = self::term($this->filters['q'] ?? null);
        $limit = max(1, min((int) ($this->filters['limit'] ?? 30), self::MAX_LIMIT));

        // Krátky dopyt nie je chyba, ale prázdny výsledok. Endpoint ho odmietne
        // validátorom (422), MCP tool posiela argumenty tak, ako ich napísal model
        // — a `LIKE '%%'` by mu vrátilo celú konverzačnú históriu appky.
        if (mb_strlen($term) < self::MIN_QUERY) {
            return [
                'query' => $term,
                'items' => [],
                'threads' => [],
                'projects' => [],
                'counts' => ['total' => 0, 'shown' => 0, 'threads' => 0],
                'limit' => $limit,
            ];
        }

        $rows = $this->base($term)
            ->select([
                'm.id as message_id', 'm.role', 'm.content', 'm.created_at',
                't.uuid as thread', 't.title as thread_title', 't.archived_at as thread_archived_at',
                'p.uuid as project', 'p.name as project_name',
                'b.uuid as branch',
            ])
            // Najnovšie najprv. Radí sa podľa `id`, nie podľa `created_at`: `id` je
            // poradie vzniku a je unikátne, takže dve správy v tej istej sekunde
            // (odpoveď modelu a jeho tool call) nemajú neurčené poradie. Zoradenie
            // je dáta — keby si ho robil klient, stránka by po zmene stropu vracala
            // iné riadky než počty.
            ->orderByDesc('m.id')
            ->limit($limit)
            ->get();

        $threads = $this->threadFacet($term);

        return [
            'query' => $term,
            'items' => $rows->map(fn (object $row): array => $this->row($row, $term))->all(),
            // Skupiny sú dáta: bez nich by si ich prehliadač počítal z načítanej
            // stránky a čip by sľuboval číslo, ktoré zoznam nedá (nález auditu
            // 19. 8. 2026 na Denníku).
            'threads' => $threads,
            'projects' => $this->projectFacet($threads),
            'counts' => [
                // Nad CELÝM zásahom, nie nad stránkou.
                'total' => $this->base($term)->count(),
                'shown' => $rows->count(),
                'threads' => $this->base($term)->distinct()->count('m.thread_id'),
            ],
            'limit' => $limit,
        ];
    }

    public function fieldsForAi(): array
    {
        return [
            'query', 'counts',
            'items[].message_id', 'items[].thread', 'items[].thread_title',
            'items[].project_name', 'items[].branch', 'items[].role',
            'items[].snippet', 'items[].matches', 'items[].at',
            'threads[].thread', 'threads[].title', 'threads[].project_name',
            'threads[].matches',
        ];
    }

    // ---- hľadanie ----------------------------------------------------------

    /**
     * Dopyt bez `SELECT`u — používa ho zoznam, počty aj skupiny, aby filtre
     * existovali **raz**. Dva dopyty s ručne prepísanou podmienkou sú to isté
     * riziko rozchodu ako dve plochy.
     *
     * Systémová správa je vylúčená vždy: je to konfigurácia behu (systémový
     * prompt, ktorý `AgentRunner` zapíše raz na vlákno), nie krok konverzácie.
     * Bez tohto filtra by dopyt na čokoľvek zo smernice vrátil zásah v každom
     * vlákne appky.
     *
     * Čítá sa cez `DB::table`, nie cez model: je to projekcia z troch spojených
     * tabuliek na jeden riadok výsledku, žiadne chovanie modelu tu netreba, a
     * hydratovaný `ConsoleMessage` s prilepenými cudzími stĺpcami by tvrdil, že
     * je správou, ktorá má `project_name`.
     */
    private function base(string $term): Builder
    {
        $query = DB::table('console_messages as m')
            ->join('console_threads as t', 't.id', '=', 'm.thread_id')
            ->leftJoin('console_projects as p', 'p.id', '=', 't.project_id')
            ->leftJoin('console_branches as b', 'b.id', '=', 'm.branch_id')
            ->whereIn('m.role', ['user', 'assistant'])
            ->whereRaw(
                "LOWER(m.content) LIKE ? ESCAPE '".self::LIKE_ESCAPE."'",
                ['%'.self::likeTerm($term).'%'],
            );

        if (($thread = self::term($this->filters['thread'] ?? null)) !== '') {
            $query->where('t.uuid', $thread);
        }

        if (($project = self::term($this->filters['project'] ?? null)) !== '') {
            $query->where('p.uuid', $project);
        }

        if (in_array($role = self::term($this->filters['role'] ?? null), ['user', 'assistant'], true)) {
            $query->where('m.role', $role);
        }

        // Neplatný dátum = žiadny filter, nie výnimka. Ten istý dôvod ako
        // v {@see RunsScreen}: MCP tool posiela `$args` surové a
        // `Carbon::parse('vcera')` by skončilo neurčitým `isError`, z ktorého sa
        // model nedozvie, čo urobil zle.
        if (($from = self::date($this->filters['from'] ?? null)) !== null) {
            $query->where('m.created_at', '>=', $from);
        }

        if (($to = self::date($this->filters['to'] ?? null)) !== null) {
            // Samotný dátum bez času znamená CELÝ deň. Bez toho by `to=2026-08-25`
            // znamenalo polnoc a vyhodilo by práve ten deň, ktorý si človek vybral.
            $query->where('m.created_at', '<=', self::dateOnly($this->filters['to']) ? $to->copy()->endOfDay() : $to);
        }

        return $query;
    }

    /**
     * Vlákna so zásahmi a ich počty — v SQL, nie v prehliadači.
     *
     * Zoznam je zastropovaný na {@see FACET_LIMIT}. Pravdu o počte vlákien nesie
     * `counts.threads`, ktoré ide nad celým zásahom — čip, ktorý sľubuje viac než
     * vie zoznam dať, je presne ten nález, ktorý audit označil za tichú lož.
     *
     * @return list<array<string, mixed>>
     */
    private function threadFacet(string $term): array
    {
        return $this->base($term)
            ->select([
                't.uuid as thread', 't.title as title',
                'p.uuid as project', 'p.name as project_name',
                DB::raw('COUNT(*) as matches'),
            ])
            ->groupBy('t.uuid', 't.title', 'p.uuid', 'p.name')
            ->orderByDesc('matches')
            ->orderBy('t.uuid')
            ->limit(self::FACET_LIMIT)
            ->get()
            ->map(fn (object $row): array => [
                'thread' => $row->thread,
                'title' => $row->title,
                'project' => $row->project,
                'project_name' => $row->project_name,
                'matches' => (int) $row->matches,
            ])
            ->all();
    }

    /**
     * Projekty so zásahmi — súčet nad skupinami vlákien, v PHP.
     *
     * Druhý `GROUP BY` dopyt by nad tým istým skenom stál to isté ako prvý, takže
     * sa sčítáva už načítaná skupina. Dôsledok, ktorý treba poznať: keď zásahy
     * presahujú {@see FACET_LIMIT} vlákien, sú aj tieto počty len z toho výseku.
     * Preto tu **nie je** kľúč `total` — celok hovorí `counts`.
     *
     * Vlákna bez projektu tu vlastný riadok nedostávajú: `{uuid: null}` by po
     * `dropEmpty()` skončil ako `{matches: N}`, teda číslo bez toho, k čomu patrí.
     *
     * @param  list<array<string, mixed>>  $threads
     * @return list<array<string, mixed>>
     */
    private function projectFacet(array $threads): array
    {
        $out = [];

        foreach ($threads as $row) {
            if (($uuid = $row['project'] ?? null) === null) {
                continue;
            }

            $out[$uuid] ??= ['project' => $uuid, 'name' => $row['project_name'], 'threads' => 0, 'matches' => 0];
            $out[$uuid]['threads']++;
            $out[$uuid]['matches'] += $row['matches'];
        }

        usort($out, static fn (array $a, array $b): int => [$b['matches'], $a['name']] <=> [$a['matches'], $b['name']]);

        return array_values($out);
    }

    /**
     * Jeden riadok výsledku.
     *
     * `branch` je tu preto, aby UI vedelo povedať, že zásah leží v inej vetve —
     * hľadanie **zámerne prehľadáva aj opustené vetvy**. História, ktorá sa
     * editáciou správy odsunula do bočnej vetvy, sa nestala nenapísanou; nájsť ju
     * je celý zmysel hľadania v histórii.
     *
     * @return array<string, mixed>
     */
    private function row(object $row, string $term): array
    {
        $at = $row->created_at === null ? null : Carbon::parse($row->created_at);
        $text = self::flatten((string) $row->content);

        return [
            'message_id' => (int) $row->message_id,
            'thread' => $row->thread,
            'thread_title' => $row->thread_title,
            'project' => $row->project,
            'project_name' => $row->project_name,
            'branch' => $row->branch,
            'role' => $row->role,
            'snippet' => self::snippet($text, $term),
            'matches' => self::countMatches($text, $term),
            // Archivované vlákno sa v paneli nezobrazuje, ale nájsť sa v ňom dá.
            // `false` prežije `dropEmpty()` — nula zásahov aj „nearchivované" sú
            // informácia, kým chýbajúci kľúč je ticho.
            'archived' => $row->thread_archived_at !== null,
            'at' => $at?->toIso8601String(),
            // Kľúč na zoskupenie po dňoch. Hranicu dňa určuje časová zóna servera,
            // takže keby si ju klient počítal sám, dva zásahy okolo polnoci by
            // v UI a v odpovedi pre AI spadli do iných dní. Popisok „dnes/včera"
            // je naopak slovo a robí ho UI.
            'day' => $at?->toDateString(),
        ];
    }

    /**
     * Útržok s kontextom, nie celá správa.
     *
     * Krátenie je TU a nie v prehliadači, aby človek aj AI čítali ten istý text —
     * to isté rozhodnutie ako `prompt` v {@see RunsScreen::row()}.
     *
     * Zásah sa hľadá `mb_stripos` nad zlomenými bielymi znakmi. Keď ho PHP
     * nenájde, hoci DB zhodu ohlásila (na MariaDB to dokáže unicode-ci
     * porovnanie), vráti sa začiatok správy — útržok bez zásahu je horší než
     * prázdny riadok, ale tichý pád na výnimku by bol najhorší.
     */
    public static function snippet(string $text, string $term): string
    {
        $max = self::SNIPPET_BEFORE + self::SNIPPET_AFTER;
        $pos = $term === '' ? false : mb_stripos($text, $term);

        if ($pos === false) {
            return self::clip($text, $max);
        }

        $start = max(0, $pos - self::SNIPPET_BEFORE);
        $length = self::SNIPPET_BEFORE + mb_strlen($term) + self::SNIPPET_AFTER;
        $cut = mb_substr($text, $start, $length);

        return ($start > 0 ? '…' : '')
            .$cut
            .($start + mb_strlen($cut) < mb_strlen($text) ? '…' : '');
    }

    /** Koľkokrát sa dopyt v správe vyskytuje — číslo do riadku, nie do UI dopočtu. */
    private static function countMatches(string $text, string $term): int
    {
        if ($term === '') {
            return 0;
        }

        return mb_substr_count(mb_strtolower($text), mb_strtolower($term));
    }

    // ---- export ------------------------------------------------------------

    /**
     * Vlákno ako markdown — jeden dokument, poskládaný na serveri.
     *
     * Prečo serverom: aby obe plochy dostali to isté. Smernica sa v prehliadači
     * aj na serveri skladala dvakrát a texty sa líšili na 20 zo 48 riadkov (PHP
     * krátil na `...`, JS na `…`) — export je presne ten istý druh obsahu.
     *
     * Tri veci, ktoré do exportu **nepatria** a je to rozhodnutie, nie opomenutie:
     *
     *  1. **Systémová smernica.** Je to konfigurácia behu (~2,6k tokenov), nie
     *     krok konverzácie, a v exporte by prekryla všetko ostatné. Ten istý
     *     dôvod, z akého ju vynecháva `RunDetailScreen::timeline()` aj
     *     `ThreadController::payload()`.
     *  2. **Obsah príloh.** Príloha sa uvádza **menom**, typom a veľkosťou.
     *     `console_attachments.text_content` je cache pre prompt, nie časť
     *     konverzácie, a vylepiť 20 MB PDF do markdownu by z exportu urobilo
     *     nečitateľný súbor.
     *  3. **Výsledky toolov.** Zapisujú sa meno, stav a argumenty (zastropované);
     *     výsledok toolu môže byť celý súbor a export konverzácie nie je log
     *     behu — na to je obrazovka Runy.
     *
     * História sa skládá cez {@see ConsoleThread::branchMessages()}, teda tým
     * istým dopytom, ktorým ju vidí model. Druhé skládanie reťaze vetvy by bola
     * druhá implementácia jednej pravdy.
     */
    public static function markdown(ConsoleThread $thread, ?ConsoleBranch $branch = null): string
    {
        $messages = $thread->branchMessages($branch)
            ->where('role', '!=', 'system')
            ->orderBy('id')
            ->get();

        // Prílohy a tool cally sa načítajú DVOMA dopytmi nad celým vláknom, nie
        // dvoma na správu: export sto správ by inak stál dvesto dopytov.
        $ids = $messages->pluck('id')->map(fn ($id): int => (int) $id)->all();
        $attachments = self::rowsByMessage('console_attachments', $ids, ['message_id', 'original_name', 'mime', 'size_bytes']);
        $toolCalls = self::rowsByMessage('console_tool_calls', $ids, ['message_id', 'name', 'status', 'arguments']);

        $lines = self::exportHead($thread, $branch, $messages);

        foreach ($messages as $message) {
            $id = (int) $message->id;

            $lines[] = '## '.self::speaker($message->role).self::stamp($message->created_at);
            $lines[] = '';
            $lines[] = trim((string) $message->content);
            $lines[] = '';

            foreach (self::exportAttachments($attachments[$id] ?? []) as $line) {
                $lines[] = $line;
            }

            foreach (self::exportToolCalls($toolCalls[$id] ?? []) as $line) {
                $lines[] = $line;
            }
        }

        // Jeden koncový nový riadok, nie tri: markdown súbor má končiť riadkom.
        return rtrim(implode("\n", $lines), "\n")."\n";
    }

    /**
     * Meno súboru na stiahnutie.
     *
     * `Str::slug` zhodí diakritiku aj interpunkciu, takže z názvu vlákna nikdy
     * nevznikne meno s lomkou, uvozovkou ani novým riadkom — a práve to sa posiela
     * v hlavičke `Content-Disposition`. Vlákno bez použiteľného názvu dostane
     * `vlakno`, nie prázdny základ.
     */
    public static function exportName(ConsoleThread $thread): string
    {
        $slug = Str::slug((string) $thread->title);
        $slug = $slug === '' ? 'vlakno' : Str::limit($slug, 60, '');
        $day = ($thread->last_message_at ?? $thread->created_at ?? Carbon::now())->toDateString();

        return $slug.'-'.$day.'.md';
    }

    /**
     * Hlavička dokumentu. Čo o vlákne nevieme, sa nevypíše — riadok „Projekt: —"
     * je šum, ktorý sa v exporte nedá odfiltrovať.
     *
     * @param  \Illuminate\Support\Collection<int, ConsoleMessage>  $messages
     * @return list<string>
     */
    private static function exportHead(ConsoleThread $thread, ?ConsoleBranch $branch, $messages): array
    {
        $title = trim((string) $thread->title);
        $lines = ['# '.($title === '' ? 'Vlákno bez názvu' : $title), ''];

        $meta = ['Vlákno: `'.$thread->uuid.'`'];

        if (($project = $thread->project_id === null ? null : $thread->project) !== null) {
            $meta[] = 'Projekt: '.$project->name;
        }

        // Vetvu uvádzame len keď je vlákno naozaj vetvené. Pri jedinej vetve je
        // to uuid bez informácie.
        $current = $branch ?? $thread->currentBranch();

        if ($current !== null && $thread->branches()->count() > 1) {
            $meta[] = 'Vetva: `'.$current->uuid.'`';
        }

        if (($model = trim((string) $thread->model)) !== '') {
            $meta[] = 'Model: '.trim((string) $thread->provider).' / '.$model;
        }

        $meta[] = 'Správ: '.$messages->count();

        if ($messages->isNotEmpty()) {
            $meta[] = 'Prvá správa: '.self::moment($messages->first()->created_at);
            $meta[] = 'Posledná správa: '.self::moment($messages->last()->created_at);
        }

        foreach ($meta as $line) {
            $lines[] = '- '.$line;
        }

        $lines[] = '';
        $lines[] = '---';
        $lines[] = '';

        return $lines;
    }

    /**
     * Riadky jednej tabuľky pre všetky správy exportu, zoskupené podľa
     * `message_id`.
     *
     * Čítá sa cez `DB::table`, nie cez model: `console_attachments` model v čase
     * vzniku tejto triedy nemá a export je čisté čítanie metadát. Prázdna trieda
     * do zásoby by bola horšia než jeden explicitný dopyt.
     *
     * `message_id IS NULL` sa nikdy nenačítá, pretože filtrujeme na `$ids`: sú to
     * rozpracované prílohy (súbor v okne vstupu, správa neodoslaná) a zaparkované
     * tool cally behu, ktorý ešte nemá odpoveď. Do skončenej konverzácie nepatria.
     *
     * @param  list<int>  $ids
     * @param  list<string>  $columns
     * @return array<int, list<object>>
     */
    private static function rowsByMessage(string $table, array $ids, array $columns): array
    {
        if ($ids === []) {
            return [];
        }

        $out = [];

        foreach (DB::table($table)->whereIn('message_id', $ids)->orderBy('id')->get($columns) as $row) {
            $out[(int) $row->message_id][] = $row;
        }

        return $out;
    }

    /**
     * Prílohy správy — **menom, nie obsahom** (viď docblock {@see markdown()}).
     *
     * @param  list<object>  $rows
     * @return list<string>
     */
    private static function exportAttachments(array $rows): array
    {
        if ($rows === []) {
            return [];
        }

        $lines = ['**Prílohy:**', ''];

        foreach ($rows as $row) {
            $lines[] = '- `'.$row->original_name.'` — '.$row->mime.', '.self::bytes((int) $row->size_bytes);
        }

        $lines[] = '';

        return $lines;
    }

    /**
     * Nástroje, ktoré správa vyžiadala — meno, stav a argumenty.
     *
     * Stav sa prekladá do slovenčiny, pretože export čítá človek. `denied` je
     * koncový stav, nie chyba: dvojfázová brána znamená, že zamietnutý zápis je
     * legitímny výsledok ťahu a v exporte má byť vidieť.
     *
     * @param  list<object>  $rows
     * @return list<string>
     */
    private static function exportToolCalls(array $rows): array
    {
        $lines = [];

        foreach ($rows as $row) {
            $args = self::clip(self::flatten((string) ($row->arguments ?? '')), self::EXPORT_ARGS_CAP);
            $lines[] = '**Nástroj** `'.$row->name.'` — '.self::toolStatus((string) $row->status)
                .($args === '' ? '' : "\n\n```json\n".$args."\n```");
            $lines[] = '';
        }

        return $lines;
    }

    private static function speaker(string $role): string
    {
        return match ($role) {
            'user' => 'Ty',
            'assistant' => 'Charón',
            default => $role,
        };
    }

    private static function toolStatus(string $status): string
    {
        // Presne päť stavov, ktoré pripúšťa `console_tool_calls.status` (enum
        // v migrácii `create_console_tables`). Šiesty preklad by bol mŕtvy kód,
        // ktorý o schéme tvrdí niečo, čo v nej nie je.
        return match ($status) {
            'pending' => 'čaká na rozhodnutie',
            'running' => 'beží',
            'done' => 'vykonané',
            'denied' => 'zamietnuté',
            'failed' => 'zlyhalo',
            default => $status,
        };
    }

    /** Časová značka v hlavičke správy. Prázdna, keď čas nepoznáme. */
    private static function stamp(?Carbon $at): string
    {
        return $at === null ? '' : ' · '.self::moment($at);
    }

    /**
     * Okamih v exporte. `Y-m-d H:i` v časovej zóne servera, nie ISO8601: export
     * čítá človek a `2026-08-25T10:00:00+02:00` je v texte hluk. Presnejšie časy
     * a trvania sú v logu behov, kde majú svoju obrazovku.
     */
    private static function moment(?Carbon $at): string
    {
        return $at === null ? '' : $at->format('Y-m-d H:i');
    }

    /** Veľkosť súboru do zoznamu príloh. */
    private static function bytes(int $size): string
    {
        if ($size < 1024) {
            return $size.' B';
        }

        if ($size < 1024 * 1024) {
            return str_replace('.', ',', (string) round($size / 1024, 1)).' kB';
        }

        return str_replace('.', ',', (string) round($size / 1024 / 1024, 1)).' MB';
    }

    // ---- spoločné pomôcky --------------------------------------------------

    /**
     * Dopyt ako text, alebo prázdno. MCP tool posiela argumenty tak, ako ich
     * napísal model, takže tu môže pristáť pole aj objekt — `(string) []` by bolo
     * varovanie a `where('t.uuid', [])` chyba dopytu.
     */
    private static function term(mixed $value): string
    {
        return is_scalar($value) ? trim((string) $value) : '';
    }

    /** Dátum filtra, alebo `null` pri prázdnom aj pri nezmyselnom vstupe. */
    private static function date(mixed $value): ?Carbon
    {
        if (($text = self::term($value)) === '') {
            return null;
        }

        try {
            return Carbon::parse($text);
        } catch (\Throwable) {
            return null;
        }
    }

    /** Je to dátum bez času (`2026-08-25`)? Podľa toho sa `to` roztiahne na celý deň. */
    private static function dateOnly(mixed $value): bool
    {
        return (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', self::term($value));
    }

    /**
     * Dopyt pre `LIKE`: zástupné znaky od človeka sú **hľadaný text, nie vzor**.
     * Bez tohto by dopyt „100%" vrátil každú správu v appke a `_` by bol
     * ľubovoľný znak. Escapuje sa aj samotný escape znak, inak by sa `!` v dopyte
     * zjedol.
     */
    private static function likeTerm(string $term): string
    {
        return str_replace(
            [self::LIKE_ESCAPE, '%', '_'],
            [self::LIKE_ESCAPE.self::LIKE_ESCAPE, self::LIKE_ESCAPE.'%', self::LIKE_ESCAPE.'_'],
            mb_strtolower($term),
        );
    }

    /** Biele znaky na jednu medzeru — útržok aj argumenty sú jeden riadok. */
    private static function flatten(string $text): string
    {
        return trim(preg_replace('/\s+/u', ' ', $text) ?? $text);
    }

    private static function clip(string $text, int $max): string
    {
        if (mb_strlen($text) <= $max) {
            return $text;
        }

        return mb_substr($text, 0, $max - 1).'…';
    }
}
