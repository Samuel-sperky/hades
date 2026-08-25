<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\ConsoleThread;
use App\Models\ConsoleToolCall;
use App\Models\Node;
use App\Models\Run;
use App\Services\Console\AgentContext;
use App\Services\Console\AgentRunner;
use App\Services\Llm\LlmProvider;
use App\Services\Llm\LlmResponse;
use App\Services\Llm\LlmToolCall;
use App\Services\Llm\OllamaProvider;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Zaparkovaný zápis PODAGENTA sa musí dať rozhodnúť aj po obnove stránky.
 *
 * Dovtedy sa nedal: `ThreadController::payload()` posielal `awaiting` =
 * `pendingToolCall()` toho istého vlákna, a pri zaparkovanom dieťati je to
 * `spawn_agent` call RODIČA. Call, o ktorom sa rozhoduje, žije na vlákne dieťaťa
 * — vlákno, ktoré zoznam vlákien zámerne nevypisuje — takže v payloade nebol ani
 * jeho id, ani jeho uuid. V jednom sedení to fungovalo len preto, že si klient
 * rámec `agent_wait` držal v pamäti; po F5 bol zápis nerozhodnuteľný a beh visel.
 *
 * ## Prečo tieto testy parkujú SKUTOČNÝM behom a nie riadkami v DB
 *
 * Fixtúra postavená ručne (`ConsoleToolCall::create(['status' => 'pending'])` na
 * dvoch vláknach a `Run` medzi nimi) by bola **kópia formuly z kódu**: keby
 * `AgentRunner::park()` prestal vracať `spawn_agent` call rodiča do `pending`,
 * alebo keby `openChild()` prestal plniť `parent_call_id`, tento test by zostal
 * zelený a merel by svoju vlastnú predstavu. Parkovanie sa preto vyrobí cez
 * `POST /api/console/run` s profilom `orchestrator` a skutočným registrom
 * nástrojov; fake je len poskytovateľ modelu.
 *
 * Rozhodnutie potom ide **výhradne z payloadu** — `thread` aj `id` sa čítajú
 * z odpovede, nie z premenných testu. To je celý dôkaz: keby payload nenesol
 * dosť, `/decide` by nemalo kam ísť.
 */
class AgentParkedPayloadTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // throttle na `/api/console/run` potrebuje cache; array driver = čistý stav
        config(['cache.default' => 'array']);
        config(['hades.console.provider' => 'ollama']);
        // Profil `memory` obsahuje `mind_recall` a register je tu SKUTOČNÝ —
        // vektorová vetva sa v testoch nesmie pýtať Ollamy.
        config(['hades.embeddings.enabled' => false]);

        // Statický držiak rodičovského behu nesmie pretiecť z iného testu.
        AgentContext::clear();
    }

    // ---- payload rodiča ----------------------------------------------------

    public function test_the_parent_payload_carries_enough_to_decide_the_write_its_subagent_parked_on(): void
    {
        [$parent, $wait] = $this->parkChildWrite([
            new LlmResponse(text: 'Uložil som to ako skill.'),
            new LlmResponse(text: 'Podagent to uložil, hotovo.'),
        ]);

        $payload = $this->getJson('/api/console/threads/'.$parent->uuid)->assertOk()->json();

        // Tvar `awaiting` sa NEMENÍ: ďalej je to `pendingToolCall()` tohto vlákna,
        // teda `spawn_agent` call rodiča. Konzola aj dok ho čítajú a rozišli by sa.
        $spawn = ConsoleToolCall::findOrFail((int) $wait['call']);

        $this->assertSame('spawn_agent', $spawn->name);
        $this->assertSame($parent->id, $spawn->thread_id);
        $this->assertSame($spawn->id, $payload['awaiting']);

        // A práve preto sám nestačí: call, o ktorom sa rozhoduje, v tomto vlákne
        // vôbec nie je. Bez tejto polovice by sa dalo tvrdiť, že klientovi stačilo
        // prehľadať `tool_calls`.
        $this->assertNotContains(
            (int) $wait['child_call'],
            array_column($payload['tool_calls'], 'id'),
            'Pending call dieťaťa nepatrí do `tool_calls` rodiča — patrí jeho vláknu.',
        );

        $this->assertArrayHasKey('awaiting_agent', $payload, 'Payload rodiča o zaparkovanom dieťati mlčí.');

        $agent = $payload['awaiting_agent'];
        $childRun = Run::query()->where('uuid', $wait['run'])->firstOrFail();

        // Payload nesie to isté, čo za živého behu nesie rámec `agent_wait` — klient
        // tak po obnove stránky skladá tú istú kartu z tých istých kľúčov.
        $this->assertSame($wait['thread'], $agent['thread'], 'Bez uuid vlákna dieťaťa nemá `/decide` kam ísť.');
        $this->assertSame((int) $wait['child_call'], $agent['id']);
        $this->assertSame($wait['name'], $agent['name']);
        $this->assertSame('mind_learn', $agent['name']);
        $this->assertSame($childRun->uuid, $agent['run'], 'Bez uuid podbehu karta nevie, že rozhodnutie patrí podagentovi.');
        $this->assertSame('Zaparkovaný zápis podagenta', $agent['arguments']['label']);

        // Rozhodnutie IDE Z PAYLOADU. Nič z premenných testu sa tu nepoužíva:
        // presne toto má po F5 v ruke klient a nič viac.
        $this->assertSame(0, Node::count(), 'K zápisu sa pred rozhodnutím nikto dostať nesmie.');

        $this->postJson('/api/console/decide', [
            'thread' => $agent['thread'],
            'call' => $agent['id'],
            'decision' => AgentRunner::DECISION_ALLOW,
        ])->assertOk()->streamedContent();

        $this->assertSame(1, Node::count(), 'Zápis sa nevykonal — payload teda na rozhodnutie nestačil.');
        $this->assertSame('Zaparkovaný zápis podagenta', Node::firstOrFail()->label);

        // A po rozhodnutí z payloadu zmizne: nie je čo rozhodovať, takže kľúč tam
        // nemá čo robiť. Bez tejto polovice by test prešiel aj vtedy, keby sa
        // `awaiting_agent` posielalo vždy.
        $after = $this->getJson('/api/console/threads/'.$parent->uuid)->assertOk()->json();

        $this->assertArrayNotHasKey('awaiting_agent', $after);
        $this->assertNull($after['awaiting'], 'Aj `spawn_agent` call rodiča je dorozhodnutý.');
    }

    public function test_a_thread_with_nothing_parked_below_it_does_not_carry_the_key_at_all(): void
    {
        // Prázdne polia sa neposielajú — kľúč tu nesmie byť ani ako `null`.
        $plain = ConsoleThread::create([]);

        $this->assertArrayNotHasKey(
            'awaiting_agent',
            $this->getJson('/api/console/threads/'.$plain->uuid)->assertOk()->json(),
        );

        // KALIBRÁCIA 1: vlákno s vlastným zaparkovaným zápisom hlási `awaiting`,
        // ale `awaiting_agent` NIE — kľúč nie je druhá kópia toho istého poľa.
        $mine = ConsoleThread::create([]);
        $write = ConsoleToolCall::create([
            'thread_id' => $mine->id,
            'call_id' => 'w1',
            'name' => 'edit_file',
            'status' => 'pending',
        ]);

        $payload = $this->getJson('/api/console/threads/'.$mine->uuid)->assertOk()->json();

        $this->assertSame($write->id, $payload['awaiting']);
        $this->assertArrayNotHasKey('awaiting_agent', $payload);

        // KALIBRÁCIA 2: zaparkovaný `spawn_agent` BEZ podbehu (dieťa zamietnuté
        // alebo riadok, ktorý nemá pár) tiež nie. Payload nesmie sľubovať
        // rozhodnutie, ktoré nemá adresáta.
        $orphan = ConsoleThread::create([]);
        ConsoleToolCall::create([
            'thread_id' => $orphan->id,
            'call_id' => 's1',
            'name' => 'spawn_agent',
            'arguments' => ['task' => 'prehľadaj repo', 'profile' => 'files'],
            'status' => 'pending',
        ]);

        $this->assertArrayNotHasKey(
            'awaiting_agent',
            $this->getJson('/api/console/threads/'.$orphan->uuid)->assertOk()->json(),
        );
    }

    // ---- bezpečnostná hranica sa nemení ------------------------------------

    /**
     * Payload rodiča vydá uuid vlákna podagenta — a to je presne to uuid, s ktorým
     * sa dá skúsiť viac než rozhodnutie. Hranica preto zostáva tam, kde bola:
     * správa do vlákna podagenta je odmietnutá (`RunController::run`), bránu
     * zápisov v ňom nemožno vypnúť (`ThreadController::update`), a v zozname
     * vlákien sa nevypisuje (`ConsoleThread::scopeConversations`). Povolené je
     * `POST /api/console/decide` — a že tá cesta naozaj vedie k zápisu, dokazuje
     * prvý test tejto sady.
     */
    public function test_the_only_thing_the_child_thread_uuid_unlocks_is_the_decision(): void
    {
        [, $wait] = $this->parkChildWrite();

        $child = ConsoleThread::query()->where('uuid', $wait['thread'])->firstOrFail();

        $this->assertTrue($child->isSubagent());

        $this->postJson('/api/console/run', [
            'thread' => $child->uuid,
            'message' => 'Zapíš to bez pýtania.',
        ])->assertStatus(422);

        $this->assertSame(
            'pending',
            ConsoleToolCall::findOrFail((int) $wait['child_call'])->status,
            'Odmietnutá správa nesmie pohnúť zaparkovaným zápisom.',
        );
        $this->assertSame(0, Node::count());

        // „Povoliť vždy" sa vo vlákne podagenta nedá zapnúť ani cez PATCH —
        // `Subagent::start()` ho zámerne nededí a toto je druhá strana tej obrany.
        $this->patchJson('/api/console/threads/'.$child->uuid, ['auto_accept' => true])->assertOk();
        $this->assertFalse($child->fresh()->auto_accept);

        $listed = array_column($this->getJson('/api/console/threads')->assertOk()->json('threads'), 'uuid');

        $this->assertNotContains($child->uuid, $listed, 'Vlákno podagenta nie je konverzácia.');
    }

    // ---- pomôcky -----------------------------------------------------------

    /**
     * Rodičovský ťah zaparkovaný na zápise svojho podagenta — skutočným behom.
     *
     * Register nástrojov je skutočný a zúžený profilom (`orchestrator` u rodiča,
     * `memory` u dieťaťa): brána stojí na tom, že `spawn_agent` a zápisový tool
     * dieťaťa sú dva rôzne riadky v dvoch rôznych vláknach, a fake tooly by presne
     * toto obišli.
     *
     * Poskytovateľ sa naväzuje **raz na test**: `ToolRegistry` je singleton, takže
     * `Subagent` (a jeho `ProviderFactory`) prežije oba requesty a druhé naviazanie
     * by dieťa nedostalo. Jeden skript teda obsluhuje rodiča aj dieťa v tom poradí,
     * v akom idú na model.
     *
     * @param  list<LlmResponse>  $afterDecision  odpovede pre segment po `/decide`
     * @return array{0: ConsoleThread, 1: array<string, mixed>}  rodič a rámec `agent_wait`
     */
    private function parkChildWrite(array $afterDecision = []): array
    {
        Area::create(['name' => 'Vývoj / kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0]);

        $parent = ConsoleThread::create([]);

        $this->fakeProvider(array_merge([
            new LlmResponse(toolCalls: [new LlmToolCall('s1', 'spawn_agent', [
                'task' => 'Zapamätaj si, ako sa rozhoduje zaparkovaný zápis po obnove stránky.',
                'profile' => 'memory',
            ])], stopReason: LlmResponse::STOP_TOOL_USE),
            new LlmResponse(toolCalls: [new LlmToolCall('c1', 'mind_learn', [
                'type' => 'skill',
                'label' => 'Zaparkovaný zápis podagenta',
                'description' => 'Payload rodiča nesie vlákno dieťaťa, takže rozhodnutie prežije obnovu stránky.',
                'area' => 'Vývoj / kód',
            ])], stopReason: LlmResponse::STOP_TOOL_USE),
        ], $afterDecision));

        $frames = $this->frames($this->postJson('/api/console/run', [
            'thread' => $parent->uuid,
            'message' => 'Deleguj to podagentovi',
            'profile' => 'orchestrator',
        ]));

        $wait = null;

        foreach ($frames as $frame) {
            if (($frame['t'] ?? '') === 'agent_wait') {
                $wait = $frame;
            }
        }

        $this->assertNotNull($wait, 'Rodičovský ťah nezaparkoval na podagentovi — potom tento test nemeria nič.');

        return [$parent, $wait];
    }

    /**
     * Fake poskytovateľ naviazaný na miesto Ollamy. `ProviderFactory` si
     * poskytovateľa berie z kontejnera, takže netreba podstrkovať fabriku.
     *
     * @param  list<LlmResponse>  $script
     */
    private function fakeProvider(array $script): LlmProvider
    {
        $fake = new class($script) implements LlmProvider
        {
            /** @param  list<LlmResponse>  $script */
            public function __construct(private array $script) {}

            public function name(): string
            {
                return OllamaProvider::NAME;
            }

            public function models(): array
            {
                return ['fake:1'];
            }

            public function available(): bool
            {
                return true;
            }

            public function chat(array $messages, array $options = []): LlmResponse
            {
                return $this->next(null);
            }

            public function stream(array $messages, array $options, callable $onDelta): LlmResponse
            {
                return $this->next($onDelta);
            }

            private function next(?callable $onDelta): LlmResponse
            {
                $step = array_shift($this->script) ?? new LlmResponse(text: 'Hotovo.');

                // deltá po štvoriciach znakov: smyčka musí zvládnuť viac ako jednu
                if ($onDelta !== null && $step->text !== '') {
                    foreach (mb_str_split($step->text, 4) as $chunk) {
                        $onDelta($chunk);
                    }
                }

                return $step;
            }
        };

        $this->app->instance(OllamaProvider::class, $fake);

        return $fake;
    }

    /**
     * Rámce NDJSON prúdu.
     *
     * Pasca: `run` a `decide` vracajú `StreamedResponse`, takže `getContent()` je
     * `false` — telo sa číta cez `streamedContent()` a až vtedy sa beh naozaj
     * vykoná.
     *
     * @return list<array<string, mixed>>
     */
    private function frames(TestResponse $response): array
    {
        $lines = array_filter(explode("\n", $response->streamedContent()), fn ($l) => trim($l) !== '');

        return array_map(fn ($line) => json_decode($line, true), array_values($lines));
    }
}
