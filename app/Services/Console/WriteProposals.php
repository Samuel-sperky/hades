<?php

namespace App\Services\Console;

use App\Models\ConsoleThread;
use App\Models\ConsoleWriteProposal;
use App\Services\Console\Tools\ConsoleTool;
use Illuminate\Database\Eloquent\ModelNotFoundException;

/**
 * Front odložených zápisov — tretie chovanie zápisového toolu.
 *
 * Konzola dovtedy poznala dve: v prehliadači sa zápis ZAPARKUJE a čaká na klik
 * ({@see AgentRunner::resume()}), v programovom behu sa zápisový tool modelu ani
 * NEPONÚKNE ({@see HeadlessRunner::registry()}). Prvé sa v nočnom behu nedá —
 * nie je komu sa spýtať a vlákno by zamrzlo natrvalo; druhé znamená, že rozvrh
 * nedokáže navrhnúť zmenu, len napísať report.
 *
 * Toto je to tretie: NEVYKONÁ a NEZAPARKUJE, ale ZAZNAMENÁ. Model dostane
 * výsledok, z ktorého je jednoznačne vidieť, že sa nič nestalo, ťah skončí
 * normálnym `end` a vlákno zostane voľné pre ďalší beh.
 *
 * ── Prečo `approve()` volá register a nie vlastné vykonanie ─────────────────
 *
 * Cesta povolenia v UI je `POST /console/decide` → {@see AgentRunner::resume()}
 * → `executeCall()` → {@see ToolRegistry::call()}. Posledný krok je jediné miesto
 * v projekte, kde sa tool naozaj vykonáva — a je to to, čo tu voláme. `resume()`
 * sa použiť NEDÁ a nie je to obchádzka: potrebuje `pending` riadok
 * v `console_tool_calls` (teda zaparkované vlákno, čo je presne to, čomu sa front
 * vyhýba) a po vykonaní ROZBEHNE model ďalším kolom smyčky. Tu je ťah dávno
 * uzavretý; rozhodnutie človeka o dvanásť hodín neskôr nemá čo pokračovať.
 *
 * Register MUSÍ byť kánonický (celý). Headless sada zápisové tooly nemá zámerne,
 * takže povolenie prichádza z iného okruhu než beh, ktorý návrh vyrobil.
 */
final class WriteProposals
{
    /** Strop na počet otvorených návrhov, keď ho config neurčí. */
    private const DEFAULT_MAX_OPEN = 50;

    /** Koľko znakov náhľadu ide do odpovede API. Diff `write_file` vie mať 8 kB. */
    private const PAYLOAD_PREVIEW_CAP = 4000;

    public function __construct(private readonly ToolRegistry $registry) {}

    /**
     * Obal, ktorý zo zápisového toolu urobí návrh.
     *
     * Meno, schéma ani argumenty sa nemenia — model volá `write_file` a nemusí
     * o fronte vedieť nič dopredu. Mení sa dvoje: `isWrite()` je `false` (inak by
     * ťah zaparkoval, teda presne to, čo sa v programovom behu stať nesmie)
     * a `execute()` namiesto zápisu vyrobí riadok vo fronte.
     *
     * Anonymná trieda a nie súbor v `Tools/`: nie je to tool konzoly (v žiadnom
     * registri nesmie stáť sám za seba) a jeho jediný zmysel je obaliť ten, ktorý
     * dostal v konštruktore. Ako samostatná trieda by sa dala omylom pridať do
     * {@see ToolRegistry::TOOLS}, kde by tichom vypnula potvrdzovanie zápisov
     * v prehliadači.
     */
    public function proposalTool(ConsoleTool $tool, ConsoleThread $thread): ConsoleTool
    {
        return new class($tool, $thread, $this) implements ConsoleTool
        {
            public function __construct(
                private readonly ConsoleTool $inner,
                private readonly ConsoleThread $thread,
                private readonly WriteProposals $proposals,
            ) {}

            public function name(): string
            {
                return $this->inner->name();
            }

            /**
             * Popis pôvodného toolu plus veta o fronte.
             *
             * Bez tej vety model volá tool s presvedčením, že zapisuje, a v reporte
             * potom napíše „opravil som to" o zmene, ktorá sa nestala. Text je po
             * anglicky, ako všetky popisy pre model.
             */
            public function description(): string
            {
                return $this->inner->description()
                    .' IMPORTANT: in this unattended run nothing is written. The call is recorded as a '
                    .'proposal for a human to approve or deny later, and you get its id back. Propose the '
                    .'change once, then move on and say in your answer what you proposed and why.';
            }

            public function schema(): array
            {
                return $this->inner->schema();
            }

            /** Nikdy `true`: zaparkovaný ťah je to, čomu sa front vyhýba. */
            public function isWrite(): bool
            {
                return false;
            }

            public function preview(array $args): ?string
            {
                return $this->inner->preview($args);
            }

            public function execute(array $args): ToolResult
            {
                return $this->proposals->record($this->thread, $this->inner->name(), $args);
            }
        };
    }

    /**
     * Zapíše návrh a vráti výsledok, ktorý uvidí model.
     *
     * Náhľad sa počíta TERAZ, nie pri rozhodovaní: diff `write_file` platí proti
     * stavu súboru v okamihu behu a o týždeň sa už nemá z čoho poskladať.
     * {@see ToolRegistry::preview()} nikdy nehodí výnimku — odmietnutie vráti ako
     * text náhľadu, takže človek vidí aj dôvod, prečo by sa zápis aj tak nevykonal.
     *
     * @param  array<string, mixed>  $arguments
     */
    public function record(ConsoleThread $thread, string $name, array $arguments): ToolResult
    {
        // Ten istý zápis dvakrát nie je dva návrhy. Slabý model po odpovedi „nič sa
        // nevykonalo" ochotne skúsi to isté znova a človek by zajtra rozhodoval
        // o piatich kópiách jedného diffu.
        $existing = $this->duplicate($thread, $name, $arguments);

        if ($existing !== null) {
            return ToolResult::ok(
                "Already queued as proposal {$existing->uuid} — nothing was written and nothing changed. "
                .'Do not call this again; a human will decide about it.',
                ['proposal' => $existing->uuid, 'status' => $existing->status],
            );
        }

        $open = ConsoleWriteProposal::query()->open()->count();
        $max = $this->maxOpen();

        if ($open >= $max) {
            // Fronta bez stropu je fronta, ktorú nikto neprejde. Odmietnutie je
            // text pre model — nech to napíše do odpovede, nie nech to skúša znova.
            return ToolResult::refused(
                "Refused: the write proposal queue is full ({$open} of {$max} waiting for a human). "
                .'Nothing was written. Report what you wanted to change instead of proposing it.'
            );
        }

        $proposal = ConsoleWriteProposal::create([
            'thread_id' => $thread->id,
            'name' => $name,
            'arguments' => $arguments,
            'preview' => $this->registry->preview($name, $arguments),
            'status' => ConsoleWriteProposal::STATUS_PENDING,
        ]);

        return ToolResult::ok(
            "NOT EXECUTED. Recorded as write proposal {$proposal->uuid} — this run has no human to confirm "
            ."writes, so `{$name}` was queued for review and the target is unchanged. Do not retry it and do "
            .'not claim the change is done; say what you proposed and why.',
            ['proposal' => $proposal->uuid, 'status' => $proposal->status],
        );
    }

    /**
     * Povolenie: návrh sa vykoná raz a stav sa prepne.
     *
     * Idempotencia nie je pohodlie, ale rozdiel medzi „nič" a „škoda": druhé
     * `approve` na `mind_delete` by zmazalo ďalší uzol a na `write_file` prepísalo
     * súbor, ktorý medzitým niekto upravil. Riadok sa preto najprv ZABERIE
     * podmieneným UPDATE-om (`WHERE status = 'pending'`) a až potom sa tool
     * vykoná — dva súbežné requesty sa tak dohodnú v databáze, nie v PHP.
     *
     * Cena tohto poradia: keď proces spadne medzi zabraním a vykonaním, návrh
     * zostane `approved` bez vykonania. Je to zámerná voľba — nevykonaný zápis
     * človek zopakuje ručne, dvakrát vykonaný sa neodrobí.
     *
     * @throws ModelNotFoundException keď taký návrh neexistuje (framework z toho urobí 404, nie 500)
     */
    public function approve(string $uuid): ConsoleWriteProposal
    {
        $proposal = $this->find($uuid);

        if (! $this->claim($proposal, ConsoleWriteProposal::STATUS_APPROVED)) {
            return $proposal->fresh();
        }

        $result = $this->registry->call($proposal->name, $proposal->arguments ?? []);

        $proposal->result = $result->text;
        $proposal->save();

        return $proposal;
    }

    /**
     * Zamietnutie: nič sa nevykoná, stav sa prepne.
     *
     * Text v `result` je pre človeka, ktorý sa na frontu pozrie o mesiac — bez
     * neho je zamietnutý návrh riadok bez vysvetlenia, prečo je bez výsledku.
     *
     * @throws ModelNotFoundException
     */
    public function deny(string $uuid): ConsoleWriteProposal
    {
        $proposal = $this->find($uuid);

        if (! $this->claim($proposal, ConsoleWriteProposal::STATUS_DENIED)) {
            return $proposal->fresh();
        }

        $proposal->result = 'Zamietnuté človekom — tool sa nevykonal.';
        $proposal->save();

        return $proposal;
    }

    /**
     * Otvorená fronta pre výpis (`hades pending`).
     *
     * Radí sa od najstaršieho: fronta sa prechádza v poradí, v akom vznikla, a
     * návrh z predvčerajšej noci nemá zapadnúť pod dnešný.
     *
     * @return array{proposals: list<array<string, mixed>>, total: int}
     */
    public function listOpen(?string $threadUuid = null, int $limit = 50): array
    {
        $query = ConsoleWriteProposal::query()->open()->with('thread');

        if ($threadUuid !== null && trim($threadUuid) !== '') {
            // `whereHas` a nie join: neznáme uuid vlákna má vrátiť prázdnu frontu,
            // nie celú.
            $query->whereHas('thread', fn ($t) => $t->where('uuid', trim($threadUuid)));
        }

        $total = $query->count();

        $rows = $query->orderBy('id')->limit(max(1, $limit))->get();

        return [
            'proposals' => $rows->map(fn (ConsoleWriteProposal $p) => $this->payload($p))->all(),
            'total' => $total,
        ];
    }

    /**
     * Jeden návrh v tvare pre klienta.
     *
     * Náhľad sa strihá a rez sa PRIZNÁVA (`preview_truncated`) — človek, ktorý
     * nevie, že mu chýba koniec diffu, povolí zápis, ktorého druhú polovicu
     * nevidel.
     *
     * @return array<string, mixed>
     */
    public function payload(ConsoleWriteProposal $proposal): array
    {
        $preview = (string) $proposal->preview;
        $truncated = mb_strlen($preview) > self::PAYLOAD_PREVIEW_CAP;

        return array_filter([
            'id' => $proposal->uuid,
            'thread' => $proposal->thread?->uuid,
            'name' => $proposal->name,
            'arguments' => $proposal->arguments ?? [],
            'preview' => $truncated ? mb_substr($preview, 0, self::PAYLOAD_PREVIEW_CAP) : $preview,
            'preview_truncated' => $truncated ?: null,
            'status' => $proposal->status,
            'created_at' => $proposal->created_at?->toIso8601String(),
            'decided_at' => $proposal->decided_at?->toIso8601String(),
            'result' => $proposal->result,
        ], static fn ($value) => $value !== null);
    }

    /**
     * @throws ModelNotFoundException
     */
    public function find(string $uuid): ConsoleWriteProposal
    {
        return ConsoleWriteProposal::where('uuid', trim($uuid))->firstOrFail();
    }

    /**
     * Zaberie návrh pre jedno rozhodnutie. `false` = rozhodlo sa už predtým.
     *
     * Podmienka je v UPDATE-e, nie v `if` nad prečítaným modelom: medzi čítaním
     * a zápisom sa vojde druhý request a tool by sa vykonal dvakrát.
     */
    private function claim(ConsoleWriteProposal $proposal, string $status): bool
    {
        $decidedAt = now();

        $claimed = ConsoleWriteProposal::query()
            ->whereKey($proposal->getKey())
            ->where('status', ConsoleWriteProposal::STATUS_PENDING)
            ->update(['status' => $status, 'decided_at' => $decidedAt, 'updated_at' => $decidedAt]);

        if ($claimed === 0) {
            return false;
        }

        // Model v ruke musí vedieť to, čo je v DB — inak by `save()` nižšie vrátil
        // stav späť na `pending`.
        $proposal->status = $status;
        $proposal->decided_at = $decidedAt;

        return true;
    }

    /**
     * Otvorený návrh na to isté v tom istom vlákne, alebo `null`.
     *
     * Porovnáva sa v PHP a nie dopytom nad JSON stĺpcom: tvar `arguments` sa
     * naprieč MariaDB a SQLite líši a otvorených návrhov jedného vlákna je
     * jednotky, nie tisíce.
     *
     * @param  array<string, mixed>  $arguments
     */
    private function duplicate(ConsoleThread $thread, string $name, array $arguments): ?ConsoleWriteProposal
    {
        return ConsoleWriteProposal::query()
            ->open()
            ->where('thread_id', $thread->id)
            ->where('name', $name)
            ->orderBy('id')
            ->get()
            ->first(fn (ConsoleWriteProposal $p) => ($p->arguments ?? []) == $arguments);
    }

    private function maxOpen(): int
    {
        return max(1, (int) config('hades.console.proposals.max_open', self::DEFAULT_MAX_OPEN));
    }
}
