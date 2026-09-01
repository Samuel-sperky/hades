<?php

namespace App\Serializers\Screen;

use App\Models\Run;
use App\Serializers\ScreenSerializer;
use Illuminate\Support\Carbon;

/**
 * Obrazovka Runy — zoznam behov.
 *
 * Jeden zdroj pre `GET /api/runs` (človek) aj pre `mind_runs` (AI). Filtre sú tu,
 * nie na klientovi: audit ukázal, že práve klientske dopočítavanie je miesto, kde
 * sa dve plochy rozchádzajú (Denník počítal projekty z 50 načítaných záznamov,
 * hoci server posiela všetky).
 */
class RunsScreen extends ScreenSerializer
{
    /** Strop na jednu stránku. Vyššie čísla nemá zmysel posielať ani človeku. */
    public const MAX_LIMIT = 200;

    /**
     * Povolené radenie: **kľúč z odpovede → skutočný stĺpec**.
     *
     * Whitelist a nie „escapuj názov stĺpca": `ORDER BY` sa v Laravelu neparametrizuje
     * (`orderBy()` vloží identifikátor do SQL), takže hodnota od klienta by tam
     * nesmela doraziť ani v okliestenej podobe. Mapa navyše drží, že verejný kľúč je
     * vec kontraktu a nie mena stĺpca v DB — keby sa stĺpec premenoval, mení sa
     * hodnota, nie kontrakt.
     *
     * Radenie MUSÍ byť tu a nie v prehliadači: tabuľka Runov si dovtedy radila
     * načítané okno, takže „prvý najdrahší beh" znamenal „najdrahší z posledných 50",
     * čo je pri strope 200 a 13 živých riadkoch neviditeľné dnes a lož zajtra.
     *
     * @var array<string, string>
     */
    public const SORTS = [
        'started_at' => 'started_at',
        'ended_at' => 'ended_at',
        'duration_ms' => 'duration_ms',
        'tokens_in' => 'tokens_in',
        'tokens_out' => 'tokens_out',
        'tokens_per_second' => 'tokens_per_second',
        'steps' => 'steps',
        'tool_calls' => 'tool_calls',
        'status' => 'status',
        'model' => 'model',
        'source' => 'source',
    ];

    /** Predvolené radenie — presne to, čo obrazovka mala pred zavedením `sort`. */
    public const DEFAULT_SORT = 'started_at';

    /**
     * @param  array<string, mixed>  $filters  status, model, source, thread, since, q, sort, dir, limit
     */
    public function __construct(private array $filters = []) {}

    public function data(): array
    {
        $limit = min((int) ($this->filters['limit'] ?? 50), self::MAX_LIMIT);
        $limit = max($limit, 1);

        // `parent` sa dotahuje jedným dopytom navyše, nie na riadok. Bez `with()`
        // by strom podbehov v zozname stál N+1 dopytov pri strope 200 riadkov.
        $query = Run::query()->with(['thread:id,uuid,title', 'parent:id,uuid']);

        if (($status = self::text($this->filters['status'] ?? null)) !== '') {
            $query->where('status', $status);
        }

        if (($model = self::text($this->filters['model'] ?? null)) !== '') {
            $query->where('model', $model);
        }

        if (($source = self::text($this->filters['source'] ?? null)) !== '') {
            $query->where('source', $source);
        }

        if (($thread = self::text($this->filters['thread'] ?? null)) !== '') {
            $query->whereHas('thread', fn ($q) => $q->where('uuid', $thread));
        }

        // `since` prichádza z DVOCH ciest a len jedna z nich validuje: `RunsController`
        // áno, MCP tool posiela `$args` surové. `Carbon::parse('vcera')` vyhodí
        // výnimku, ktorú by `tools/call` zabalil do neurčitého `isError` — model by
        // sa nedozvedel, čo urobil zle. Nevalidný dátum sa preto ticho ignoruje
        // a filter sa neuplatní.
        if (($since = self::text($this->filters['since'] ?? null)) !== '') {
            try {
                $query->where('started_at', '>=', Carbon::parse($since));
            } catch (\Throwable) {
                // neplatný dátum = žiadny filter
            }
        }

        // Hľadanie v zadaní behu. `LIKE` a nie FULLTEXT zámerne: promptov je rádovo
        // menej než uzlov a index by tu bol náklad bez merateľného zisku.
        if (($q = self::text($this->filters['q'] ?? null)) !== '') {
            $query->where('prompt', 'like', '%'.$q.'%');
        }

        // Počet PO filtri sa musí vziať PRED oknom, teda z klonu bez `limit`.
        // `counts` je zámerne nad celou tabuľkou (viď jeho komentár), takže bez
        // tohto čísla nemá „N z M" pri filtri odkiaľ vziať to M — a M z `counts`
        // by bola lož: filter podľa modelu ho nezúži.
        $filteredTotal = (clone $query)->count();

        [$sort, $dir] = $this->order();

        $runs = $query
            ->orderBy(self::SORTS[$sort], $dir)
            // Rozlíšenie rovnosti. Pri radení podľa `status` alebo `model` má
            // desiatky riadkov tú istú hodnotu a bez druhého kľúča je ich poradie
            // vecou plánu dopytu — teda medzi dvoma načítaniami iné.
            ->orderBy('id', $dir)
            ->limit($limit)
            ->get();

        return [
            'items' => $runs->map(fn (Run $run): array => $this->row($run))->all(),
            'counts' => $this->counts(),
            'filtered_total' => $filteredTotal,
            'models' => $this->distinct('model'),
            'sources' => $this->distinct('source'),
            // Echo skutočne použitého radenia: klient nesmie hádať, či mu server
            // jeho `sort` prijal. Neznámy kľúč tu vidieť nikdy nebude — vráti sa
            // `started_at`, teda to, čím sa naozaj radilo.
            'sort' => $sort,
            'dir' => $dir,
            'limit' => $limit,
        ];
    }

    public function fieldsForAi(): array
    {
        return [
            // `counts` je nad celou tabuľkou, `filtered_total` po filtri. Sú to dva
            // rôzne údaje a AI potrebuje oba: bez druhého nevie, či `items` je celý
            // výsledok, alebo prvá stránka.
            'counts', 'filtered_total',
            'items[].uuid', 'items[].status', 'items[].prompt', 'items[].model',
            'items[].tool_profile',
            'items[].steps', 'items[].tool_calls', 'items[].tokens_out',
            'items[].duration_ms', 'items[].stop_reason', 'items[].error',
            'items[].started_at', 'items[].thread',
            // Uuid rodičovského behu. Pri behu, ktorý začal človek, je `null`
            // a `dropEmpty()` ho z odpovede pre AI vyhodí — význam vynechania
            // („tento beh nikto nespustil, začal ho človek") patrí do popisu
            // nástroja, nie do payloadu ako `null`.
            'items[].parent',
        ];
    }

    /**
     * Jeden riadok zoznamu.
     *
     * `prompt` je krátený na jednu vetu do zoznamu — celý je v detaile. Krátenie je
     * TU a nie v prehliadači, aby AI aj človek videli ten istý text.
     *
     * @return array<string, mixed>
     */
    private function row(Run $run): array
    {
        return [
            'uuid' => $run->uuid,
            'status' => $run->status,
            'source' => $run->source,
            'prompt' => self::clip((string) $run->prompt, 160),
            'provider' => $run->provider,
            'model' => $run->model,
            // S akou sadou nástrojov beh bežal — `null` pri behoch z čias pred
            // profilmi. Je to dáta, nie slovo, takže patrí do serializéra (nie do
            // dopočtu v prehliadači) a musí byť aj vo `fieldsForAi()`.
            'tool_profile' => $run->tool_profile,
            'steps' => $run->steps,
            'tool_calls' => $run->tool_calls,
            'tokens_in' => $run->tokens_in,
            'tokens_out' => $run->tokens_out,
            'tokens_per_second' => $run->tokens_per_second,
            'duration_ms' => $run->duration_ms,
            'stop_reason' => $run->stop_reason,
            'error' => $run->error,
            'started_at' => $run->started_at?->toIso8601String(),
            'ended_at' => $run->ended_at?->toIso8601String(),
            // Kľúč na zoskupenie časovej osi po dňoch. Je tu z toho istého dôvodu,
            // z akého Rozhodnutia dostávajú `month`: hranicu dňa určuje časová zóna
            // servera, a keby si ju klient počítal z `started_at` sám, dva behy tesne
            // okolo polnoci by v UI a v odpovedi pre AI spadli do iných dní.
            // Popisok hlavičky (dnes/včera/dátum) je naopak vizuálny a robí ho UI.
            'day' => $run->started_at?->toDateString(),
            'thread' => $run->thread?->uuid,
            'thread_title' => $run->thread?->title,
            // Rodičovský beh: pri podbehu podagenta uuid ťahu, ktorý ho spustil,
            // pri behu, ktorý začal človek, `null`. `uuid` a nie `id`: verejný
            // identifikátor nemá prezrádzať poradie ani počet behov, a takto ho
            // volajúci môže podať `mind_run`u.
            //
            // Strom sa skladá TU, nie v prehliadači — je to dáta. Odsadenie riadku,
            // ikona a slovo „podagent" sú naopak vizuál a robí ich UI.
            //
            // Pozor na jednu nepresnosť, ktorú tu vedome nechávam: `parent_run_id`
            // je bez cudzieho kľúča, takže po zmazaní rodiča ukazuje na neexistujúci
            // riadok a relácia vráti `null` — podbeh potom v tejto ploche vyzerá ako
            // beh spustený človekom. Podstrom neprepadne (riadky zostanú), len
            // stratí rodiča. Alternatíva by bola posielať uuid, ktoré sa nedá
            // otvoriť, čo je horšie: klient by naň dal odkaz vedúci na 404.
            'parent' => $run->parent?->uuid,
        ];
    }

    /**
     * Počty podľa stavu **nad celou tabuľkou, bez filtrov**. Sú v odpovedi preto,
     * aby filter v UI vedel, čo má zmysel nabídnuť, a aby AI dostala tvar behu appky
     * jedným volaním. Popis MCP toolu to musí povedať — model by inak `counts` čítal
     * ako tvar svojho filtrovaného výsledku.
     *
     * @return array<string, int>
     */
    private function counts(): array
    {
        $counts = Run::query()
            ->selectRaw('status, COUNT(*) as total')
            ->groupBy('status')
            ->pluck('total', 'status')
            ->all();

        $counts['total'] = array_sum($counts);

        return array_map('intval', $counts);
    }

    /**
     * Radenie: kľúč z whitelistu a smer.
     *
     * Neznámy `sort` sa **ticho vráti na default**, nie na výnimku — z toho istého
     * dôvodu, z akého ho ticho ignoruje `since`: `RunsController` validuje a vráti
     * 422, ale MCP tool posiela `$args` surové a `tools/call` by výnimku zabalil do
     * neurčitého `isError`, z ktorého sa model nedozvie, čo urobil zle. Fallback je
     * pritom bezpečný, pretože sa nikdy nedostane do SQL nič iné než hodnota z
     * {@see self::SORTS} — to je vlastnosť konštrukcie, nie disciplíny volajúcich.
     *
     * @return array{0: string, 1: 'asc'|'desc'}
     */
    private function order(): array
    {
        $sort = self::text($this->filters['sort'] ?? null);
        $sort = array_key_exists($sort, self::SORTS) ? $sort : self::DEFAULT_SORT;

        $dir = strtolower(self::text($this->filters['dir'] ?? null)) === 'asc' ? 'asc' : 'desc';

        return [$sort, $dir];
    }

    /**
     * @return list<string>
     */
    private function distinct(string $column): array
    {
        return Run::query()
            ->whereNotNull($column)
            ->distinct()
            ->orderBy($column)
            ->pluck($column)
            ->all();
    }

    /**
     * Filter ako text, alebo prázdno. MCP tool posiela argumenty tak, ako ich napísal
     * model, takže tu môže pristáť pole aj objekt — `(string) []` by bolo varovanie
     * a `where('status', [])` chyba dopytu.
     */
    private static function text(mixed $value): string
    {
        return is_scalar($value) ? trim((string) $value) : '';
    }

    public static function clip(string $text, int $max): string
    {
        $text = trim(preg_replace('/\s+/u', ' ', $text) ?? $text);

        if (mb_strlen($text) <= $max) {
            return $text;
        }

        return mb_substr($text, 0, $max - 1).'…';
    }
}
