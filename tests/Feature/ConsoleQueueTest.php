<?php

namespace Tests\Feature;

use App\Models\ConsoleMessage;
use App\Models\ConsoleThread;
use App\Models\ConsoleToolCall;
use App\Models\Run;
use App\Services\Console\ToolRegistry;
use App\Services\Llm\LlmProvider;
use App\Services\Llm\LlmResponse;
use App\Services\Llm\OllamaProvider;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Front zadaní (nález A18) — serverová strana toho, čo drží klientsky front.
 *
 * Samotný front je v `public/js/shared/runclient.js` a server o ňom nevie: je to
 * poradie, v ktorom plocha posiela zadania na `/api/console/run`, a nevznikol
 * preň žiadny rámec ani endpoint. Testovať sa tu preto dá to, na čo sa front
 * OPIERA, a to sú dve veci:
 *
 *  1. **Zaparkovaný zápis sa nedá preskočiť.** Front stojí, kým človek
 *     nerozhodne — a keby ho niekto (iná karta, iná plocha, budúca zmena
 *     klienta) obišiel, posledné slovo má server. Toto je bezpečnostné
 *     pravidlo dvojfázovej brány, nie pohodlie: druhé zadanie poslané okolo
 *     nerozhodnutého zápisu dá modelu novú prácu ešte pred tým, než sa o jeho
 *     zápise rozhodlo.
 *  2. **Do poradia sa nesmie dať zaradiť vlákno, do ktorého sa písať nedá.**
 *     Plocha vyberá vlákno zo zoznamu v bočnom paneli; vlákna podagentov tam
 *     nepatria, pretože beh do nich správu odmietne.
 *
 * Poskytovateľ je fake naviazaný namiesto {@see OllamaProvider} — žiadny test tu
 * nesmie čakať na CPU inferenciu. Register nástrojov je prázdny: tieto testy sa
 * pýtajú na BRÁNU, nie na tooly, a ostré tooly by ich rozbíjali cudzími chybami.
 */
class ConsoleQueueTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // throttle na /console/run potrebuje cache; array driver = čistý stav testu
        config(['cache.default' => 'array']);
        config(['hades.console.provider' => 'ollama']);
        // Vektorová vetva recallu sa v testoch nesmie pýtať Ollamy.
        config(['hades.embeddings.enabled' => false]);
    }

    /**
     * Zaparkovaný zápis front nepreskočí — a keby predsa, server ťah odmietne
     * a vlákno nechá presne tak, ako bolo.
     *
     * Zaparkovaný stav sa tu skladá priamo v DB (`pending` tool call), nie
     * prehratým behom: brána sa pýta `pendingToolCall()`, takže toto je ten istý
     * stav, len bez závislosti od scenára modelu. Overuje sa aj to, čo sa
     * NESTALO — odmietnutý ťah nesmie zapísať správu ani založiť beh, inak by
     * mal zaradený front v histórii tichú dieru.
     */
    public function test_run_is_refused_while_a_write_waits_so_the_queue_cannot_jump_the_gate(): void
    {
        $this->fakeTools();
        $this->fakeProvider();

        $thread = ConsoleThread::create([]);
        $call = ConsoleToolCall::create([
            'thread_id' => $thread->id,
            'call_id' => 'c1',
            'name' => 'edit_file',
            'arguments' => ['path' => 'a.txt'],
            'status' => 'pending',
            'preview' => "- staré\n+ nové",
        ]);

        $response = $this->postJson('/api/console/run', [
            'thread' => $thread->uuid,
            'message' => 'Ešte pridaj toto',
        ]);

        $response->assertStatus(422);

        $this->assertSame('pending', $call->fresh()->status, 'Zaparkovaný zápis musí ostať nerozhodnutý.');
        $this->assertSame(0, ConsoleMessage::where('thread_id', $thread->id)->count(), 'Odmietnutý ťah nesmie zapísať správu.');
        // Otvorený beh v logu by vlákno zamkol navždy: `openExclusive` by ďalší
        // ťah odmietal ako „už jeden beh prebieha", takže by front nedobehol ani
        // po rozhodnutí o zápise. Test sa preto pýta na STAV, nie na počet
        // riadkov — či odmietnutie stihlo riadok založiť a zavrieť, je vec
        // `RunController`a a nie tejto brány.
        $this->assertSame(
            0,
            Run::whereIn('status', ['running', 'waiting'])->count(),
            'Odmietnutý ťah nesmie nechať v logu otvorený beh.',
        );
    }

    /**
     * Payload vlákna pomenuje zaparkovaný zápis — z toho klient po obnove
     * stránky vie, že front musí stáť, aj keď o parkovaní nevidel rámec.
     */
    public function test_the_thread_payload_reports_the_pending_write_the_queue_waits_for(): void
    {
        $thread = ConsoleThread::create([]);
        $call = ConsoleToolCall::create([
            'thread_id' => $thread->id,
            'name' => 'edit_file',
            'status' => 'pending',
        ]);

        $this->getJson('/api/console/threads/'.$thread->uuid)
            ->assertOk()
            ->assertJsonPath('awaiting', $call->id);

        // Rozhodnuté = front sa smie rozbehnúť. Bez tejto polovice by test prešiel
        // aj vtedy, keby `awaiting` hlásilo hocijaký tool call bez ohľadu na stav.
        $call->update(['status' => 'done', 'result' => 'zapísané']);

        $this->getJson('/api/console/threads/'.$thread->uuid)
            ->assertOk()
            ->assertJsonPath('awaiting', null);
    }

    /**
     * Zoznam vlákien neponúkne vlákno podagenta. Nie je to kozmetika: zaradiť
     * doňho zadanie by skončilo odmietnutím od `RunController::run`, teda chybou
     * za niečo, čo rozhranie samo ponúklo.
     *
     * Kalibrácia je v teste: konverzácie v zozname BYŤ MUSIA (inak by prešiel aj
     * filter, ktorý zahodí všetko) a vlákno podagenta v DB zostáva (filtruje sa
     * výpis, nemaže sa dáta).
     */
    public function test_the_listing_hides_subagent_threads_the_queue_must_not_offer(): void
    {
        $first = ConsoleThread::create(['title' => 'prvá konverzácia']);
        $second = ConsoleThread::create(['title' => 'druhá konverzácia']);
        $child = ConsoleThread::create(['parent_thread_id' => $first->id, 'title' => 'podagent']);

        $listed = $this->getJson('/api/console/threads')->assertOk()->json('threads');
        $uuids = array_column($listed, 'uuid');

        $this->assertContains($first->uuid, $uuids);
        $this->assertContains($second->uuid, $uuids);
        $this->assertNotContains($child->uuid, $uuids, 'Vlákno podagenta nie je konverzácia a v paneli nemá čo robiť.');
        $this->assertCount(2, $uuids);

        // vlákno podagenta žije ďalej — jeho detail sa otvára z obrazovky Runy
        $this->assertDatabaseHas('console_threads', ['id' => $child->id]);
    }

    /* ---- pomôcky ---------------------------------------------------------- */

    /** Prázdny register nástrojov: tieto testy sa pýtajú na bránu, nie na tooly. */
    private function fakeTools(): void
    {
        $this->app->instance(ToolRegistry::class, new ToolRegistry([]));
    }

    /**
     * Fake poskytovateľ na miesto Ollamy. `ProviderFactory` si poskytovateľa
     * berie z kontejnera, takže netreba podstrkovať celú fabriku.
     */
    private function fakeProvider(): LlmProvider
    {
        $fake = new class implements LlmProvider
        {
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
                return new LlmResponse(text: 'Toto sa nemá stať — ťah mal byť odmietnutý.');
            }

            public function stream(array $messages, array $options, callable $onDelta): LlmResponse
            {
                $onDelta('Toto sa nemá stať — ťah mal byť odmietnutý.');

                return new LlmResponse(text: 'Toto sa nemá stať — ťah mal byť odmietnutý.');
            }
        };

        $this->app->instance(OllamaProvider::class, $fake);

        return $fake;
    }
}
