<?php

namespace Tests\Feature;

use App\Models\ConsoleMessage;
use App\Models\ConsoleSchedule;
use App\Models\ConsoleThread;
use App\Services\Llm\LlmException;
use App\Services\Llm\LlmProvider;
use App\Services\Llm\LlmResponse;
use App\Services\Llm\OllamaProvider;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Plánované behy konzoly: cron model, artisan príkaz a MCP tool nad nimi.
 *
 * Žiadny test nezavolá skutočný model — poskytovateľ je fake naviazaný do
 * kontejnera namiesto {@see OllamaProvider}, ten istý mechanizmus ako v
 * {@see ConsoleRunTest}. Register toolov je naopak SKUTOČNÝ, pretože beh rozvrhu
 * ide cez `HeadlessRunner` a to, že si ten postaví read-only sadu, je vlastnosť,
 * ktorú tu nechceme obísť.
 *
 * Čas je zmrazený (`Carbon::setTestNow`). Cron sa vyhodnocuje na minútu, takže
 * bez zmrazenia by test „rozvrh vychádza na túto minútu" bol raz za hodinu
 * červený sám od seba.
 */
class ConsoleScheduleTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config(['cache.default' => 'array']);
        config(['hades.console.provider' => 'ollama']);
        config(['hades.mcp_token' => 'test-mcp-token']);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    // ---- cron --------------------------------------------------------------

    public function test_is_due_follows_the_cron_expression(): void
    {
        $wednesdayMorning = Carbon::parse('2026-08-19 06:00:00');

        $this->assertTrue($this->schedule(cron: '* * * * *')->isDue($wednesdayMorning));
        $this->assertTrue($this->schedule(cron: '0 6 * * *')->isDue($wednesdayMorning));
        $this->assertTrue($this->schedule(cron: '0 6 * * 3')->isDue($wednesdayMorning), 'Streda je deň 3.');

        $this->assertFalse($this->schedule(cron: '0 6 * * *')->isDue($wednesdayMorning->copy()->addMinute()));
        $this->assertFalse($this->schedule(cron: '0 3 * * *')->isDue($wednesdayMorning));
        $this->assertFalse($this->schedule(cron: '0 6 * * 0')->isDue($wednesdayMorning), 'Nedeľný rozvrh v stredu nevychádza.');

        // sekundy sa zahadzujú — inak by minútový scheduler rozvrh minul
        $this->assertTrue($this->schedule(cron: '0 6 * * *')->isDue($wednesdayMorning->copy()->addSeconds(37)));
    }

    /**
     * Preklep v cron výraze je najbežnejšia chyba modelu, ktorý rozvrh zakladá.
     * Musí spadnúť pri ukladaní — inak by autor dostal „vytvorené" a príkaz by na
     * ňom padol o tretej ráno do logu, ktorý nikto nečíta.
     */
    public function test_invalid_cron_is_refused_when_saving(): void
    {
        foreach (['každú minútu', '* * *', '99 * * * *', ''] as $cron) {
            try {
                ConsoleSchedule::create([
                    'label' => 'Zlý rozvrh',
                    'prompt' => 'Sprav niečo',
                    'cron' => $cron,
                ]);

                $this->fail("Cron '{$cron}' sa nemal dať uložiť.");
            } catch (\InvalidArgumentException) {
                // presne to sa má stať
            }
        }

        $this->assertSame(0, ConsoleSchedule::count());

        // aj úprava existujúceho rozvrhu, nie len vytvorenie
        $schedule = $this->schedule(cron: '0 6 * * *');
        $schedule->cron = 'nezmysel';

        $this->expectException(\InvalidArgumentException::class);
        $schedule->save();
    }

    public function test_enabled_scope_returns_only_switched_on_schedules(): void
    {
        $on = $this->schedule(label: 'zapnutý', enabled: true);
        $this->schedule(label: 'vypnutý');

        $this->assertSame([$on->id], ConsoleSchedule::enabled()->pluck('id')->all());
    }

    // ---- MCP tool ----------------------------------------------------------

    /**
     * Toto je jadro celej fázy: AI si smie rozvrh vyrobiť, ale nie zapnúť.
     * Odpoveď to musí povedať nahlas, inak si model myslí, že beh naplánoval.
     */
    public function test_mcp_create_makes_a_disabled_schedule_and_says_so(): void
    {
        $data = $this->callTool('console_schedules', [
            'action' => 'create',
            'label' => 'Nočná hygiena',
            'prompt' => 'Prejdi hygienickú správu a napíš, čo je najhoršie',
            'cron' => '0 3 * * *',
        ]);

        $schedule = ConsoleSchedule::firstWhere('uuid', $data['schedule']['uuid']);

        $this->assertNotNull($schedule);
        $this->assertFalse($schedule->enabled, 'Rozvrh z MCP musí vzniknúť VYPNUTÝ.');
        $this->assertFalse($data['schedule']['enabled'], '`enabled: false` nesmie z odpovede vypadnúť.');
        $this->assertStringContainsString('--enable='.$schedule->uuid, $data['note']);
        $this->assertStringContainsString('DISABLED', $data['note']);
    }

    public function test_mcp_create_refuses_an_invalid_cron_without_writing_a_row(): void
    {
        $res = $this->rpc('tools/call', ['name' => 'console_schedules', 'arguments' => [
            'action' => 'create',
            'label' => 'Zlý',
            'prompt' => 'Nič',
            'cron' => 'každú minútu',
        ]])->assertOk();

        $this->assertTrue($res->json('result.isError'));
        $this->assertStringContainsString('cron', $res->json('result.content.0.text'));
        $this->assertSame(0, ConsoleSchedule::count());
    }

    public function test_mcp_create_requires_label_prompt_and_cron(): void
    {
        $res = $this->rpc('tools/call', ['name' => 'console_schedules', 'arguments' => [
            'action' => 'create',
            'label' => 'Bez promptu',
        ]])->assertOk();

        $this->assertTrue($res->json('result.isError'));
        $this->assertStringContainsString('prompt', $res->json('result.content.0.text'));
        $this->assertSame(0, ConsoleSchedule::count());
    }

    public function test_mcp_list_returns_state_of_every_schedule(): void
    {
        $this->schedule(label: 'zapnutý', cron: '0 6 * * *', enabled: true, lastRun: Carbon::parse('2026-08-18 06:00:00'));
        $this->schedule(label: 'vypnutý', cron: '*/5 * * * *');

        $rows = $this->callTool('console_schedules', ['action' => 'list'])['schedules'];

        $this->assertCount(2, $rows);
        $this->assertSame(['uuid', 'label', 'cron', 'enabled', 'last_run_at'], array_keys($rows[0]));
        $this->assertTrue($rows[0]['enabled']);
        $this->assertSame('0 6 * * *', $rows[0]['cron']);

        // vypnutý rozvrh sa v zozname NESMIE stratiť — inak by ho AI založila znova
        $this->assertFalse($rows[1]['enabled']);
        $this->assertArrayNotHasKey('last_run_at', $rows[1], 'Prázdne pole sa neposiela.');
    }

    public function test_mcp_refuses_an_unknown_action(): void
    {
        $res = $this->rpc('tools/call', [
            'name' => 'console_schedules',
            'arguments' => ['action' => 'delete'],
        ])->assertOk();

        $this->assertTrue($res->json('result.isError'));
        $this->assertStringContainsString('list, create', $res->json('result.content.0.text'));
    }

    public function test_mcp_tools_list_exposes_the_schedules_tool(): void
    {
        $names = collect($this->rpc('tools/list')->assertOk()->json('result.tools'))->pluck('name');

        $this->assertTrue($names->contains('console_schedules'));
    }

    // ---- príkaz ------------------------------------------------------------

    public function test_enable_switches_the_schedule_on_and_disable_off(): void
    {
        $schedule = $this->schedule(label: 'Nočná hygiena');

        $this->artisan('mind:console-schedules', ['--enable' => $schedule->uuid])
            ->expectsOutputToContain('ZAPNUTÝ')
            ->assertSuccessful();

        $this->assertTrue($schedule->fresh()->enabled);

        $this->artisan('mind:console-schedules', ['--disable' => $schedule->uuid])->assertSuccessful();

        $this->assertFalse($schedule->fresh()->enabled);
    }

    public function test_enable_refuses_an_unknown_uuid(): void
    {
        $this->artisan('mind:console-schedules', ['--enable' => '00000000-0000-0000-0000-000000000000'])
            ->assertFailed();
    }

    /**
     * `--list` sa číta z celého výstupu, nie cez `expectsOutputToContain`. Tabuľka
     * píše celý riadok jedným zápisom a Mockery ho pridelí PRVEJ vyhovujúcej
     * očakávanej podstringu — ostatné by potom hlásili, že v ňom nie sú, hoci sú.
     */
    public function test_list_shows_every_schedule_with_its_state(): void
    {
        $this->schedule(label: 'Nočná hygiena', cron: '0 3 * * *', enabled: true);
        $this->schedule(label: 'Vypnutý návrh AI', cron: '*/5 * * * *');

        $this->assertSame(0, Artisan::call('mind:console-schedules', ['--list' => true]));
        $output = Artisan::output();

        $this->assertStringContainsString('Nočná hygiena', $output);
        $this->assertStringContainsString('zapnutý', $output);
        // vypnutý rozvrh sa v zozname NESMIE stratiť — človek ho tam hľadá, aby ho zapol
        $this->assertStringContainsString('Vypnutý návrh AI', $output);
        $this->assertStringContainsString('vypnutý', $output);
        $this->assertStringContainsString('*/5 * * * *', $output);
    }

    /**
     * Beh musí prejsť LEN zapnutými a LEN tými, ktoré vychádzajú na túto minútu.
     * Fake poskytovateľ je nascriptovaný na jednu odpoveď — keby príkaz spustil
     * druhý rozvrh, dostal by default „Hotovo." a vlákien by bolo viac.
     */
    public function test_command_runs_only_enabled_and_due_schedules(): void
    {
        Carbon::setTestNow('2026-08-19 06:00:00');
        $this->fakeProvider([new LlmResponse(text: 'Prešiel som to.', tokensIn: 90, tokensOut: 5)]);

        $due = $this->schedule(label: 'vychádza', cron: '0 6 * * *', enabled: true);
        $notDue = $this->schedule(label: 'nevychádza', cron: '0 3 * * *', enabled: true);
        $off = $this->schedule(label: 'vypnutý', cron: '0 6 * * *');

        $this->artisan('mind:console-schedules')
            ->expectsOutputToContain('vychádza')
            ->assertSuccessful();

        $this->assertSame(1, ConsoleThread::count(), 'Spustiť sa mal presne jeden rozvrh.');

        $due->refresh();
        $this->assertNotNull($due->last_run_at);
        $this->assertSame(ConsoleThread::first()->uuid, $due->last_thread_id);

        $this->assertNull($notDue->fresh()->last_run_at);
        $this->assertNull($off->fresh()->last_run_at);

        // prompt rozvrhu je to, čo model dostal — nie label
        $this->assertDatabaseHas('console_messages', ['role' => 'user', 'content' => 'Prompt rozvrhu vychádza']);
    }

    public function test_a_schedule_that_fails_does_not_stop_the_next_one(): void
    {
        Carbon::setTestNow('2026-08-19 06:00:00');

        // prvý ťah spadne na poskytovateľovi, druhý dobehne
        $this->fakeProvider([
            new LlmException('Ollama neodpovedá.'),
            new LlmResponse(text: 'Druhý prešiel.'),
        ]);

        $first = $this->schedule(label: 'prvý', cron: '* * * * *', enabled: true);
        $second = $this->schedule(label: 'druhý', cron: '* * * * *', enabled: true);

        $this->artisan('mind:console-schedules')
            ->expectsOutputToContain('✗ prvý')
            ->expectsOutputToContain('✓ druhý')
            ->assertFailed();

        // pokus sa zapíše aj pri chybe: inak sa rozvrh, ktorý zlyháva každú noc,
        // nedá odlíšiť od rozvrhu, ktorý nikdy nebežal
        $this->assertNotNull($first->fresh()->last_run_at);
        $this->assertNotNull($second->fresh()->last_thread_id);
        $this->assertSame('Druhý prešiel.', ConsoleMessage::where('role', 'assistant')->latest('id')->value('content'));
    }

    /**
     * Riadok upravený ručne v DB obchádza validáciu modelu, takže `CronExpression`
     * na ňom vyhodí výnimku ešte pred behom. Jeden taký rozvrh nesmie zhodiť tie
     * za sebou — bez guardu okolo vyhodnotenia cronu by od tej minúty prestali
     * bežať všetky rozvrhy s vyšším id.
     */
    public function test_a_broken_cron_row_does_not_stop_the_others(): void
    {
        Carbon::setTestNow('2026-08-19 06:00:00');
        $this->fakeProvider([new LlmResponse(text: 'Zdravý rozvrh prešiel.')]);

        $broken = $this->schedule(label: 'pokazený', cron: '* * * * *', enabled: true);
        $healthy = $this->schedule(label: 'zdravý', cron: '* * * * *', enabled: true);

        DB::table('console_schedules')->where('id', $broken->id)->update(['cron' => 'toto nie je cron']);

        $this->artisan('mind:console-schedules')
            ->expectsOutputToContain('✗ pokazený')
            ->expectsOutputToContain('✓ zdravý')
            ->assertFailed();

        $this->assertSame(1, ConsoleThread::count());
        $this->assertNotNull($healthy->fresh()->last_thread_id);
    }

    public function test_command_says_when_nothing_is_due(): void
    {
        Carbon::setTestNow('2026-08-19 06:00:00');
        $this->schedule(cron: '0 3 * * *', enabled: true);

        $this->artisan('mind:console-schedules')
            ->expectsOutputToContain('nevychádza')
            ->assertSuccessful();

        $this->assertSame(0, ConsoleThread::count());
    }

    // ---- registrácia v scheduleri ------------------------------------------

    /**
     * Registrácia sa kontroluje cez scheduler, nie čítaním súboru očami. Bez
     * `withoutOverlapping` by minútový tik naskladal ďalší beh na ešte bežiaci —
     * lokálny model na CPU generuje aj niekoľko minút.
     */
    public function test_scheduler_runs_the_command_every_minute_without_overlapping(): void
    {
        $events = collect(app(Schedule::class)->events())
            ->filter(fn ($event) => str_contains((string) $event->command, 'mind:console-schedules'));

        $this->assertCount(1, $events, 'Príkaz nie je v routes/console.php zaregistrovaný práve raz.');

        $event = $events->first();
        $this->assertSame('* * * * *', $event->expression);
        $this->assertTrue($event->withoutOverlapping, 'Registrácia nemá withoutOverlapping.');
    }

    // ---- pomôcky -----------------------------------------------------------

    private function schedule(
        string $label = 'Rozvrh',
        string $cron = '0 6 * * *',
        bool $enabled = false,
        ?Carbon $lastRun = null,
    ): ConsoleSchedule {
        return ConsoleSchedule::create([
            'label' => $label,
            'prompt' => "Prompt rozvrhu {$label}",
            'cron' => $cron,
            'enabled' => $enabled,
            'last_run_at' => $lastRun,
        ]);
    }

    /** JSON-RPC POST na /mcp. */
    private function rpc(string $method, array $params = [], int $id = 1): TestResponse
    {
        return $this->withHeader('Authorization', 'Bearer test-mcp-token')
            ->postJson('/mcp', [
                'jsonrpc' => '2.0',
                'id' => $id,
                'method' => $method,
                'params' => $params,
            ]);
    }

    /** Zavolá MCP tool a vráti dekódovaný payload z `result.content[0].text`. */
    private function callTool(string $tool, array $args = []): array
    {
        $res = $this->rpc('tools/call', ['name' => $tool, 'arguments' => $args])->assertOk();

        $text = $res->json('result.content.0.text');
        $this->assertIsString($text, "tool {$tool} musí vrátiť text content");
        $this->assertFalse($res->json('result.isError'), "tool {$tool} zlyhal: {$text}");

        return json_decode($text, true);
    }

    /**
     * Fake poskytovateľ na miesto Ollamy — `ProviderFactory` si ho berie z
     * kontejnera, takže netreba podstrkovať celú fabriku. Prvok scenára typu
     * {@see LlmException} sa vyhodí namiesto odpovede; tak sa v teste vyrobí
     * zlyhaný ťah bez toho, aby bolo treba naozaj vypnutú Ollamu.
     *
     * @param  list<LlmResponse|LlmException>  $script
     */
    private function fakeProvider(array $script): LlmProvider
    {
        $fake = new class($script) implements LlmProvider
        {
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
                return $this->next();
            }

            public function stream(array $messages, array $options, callable $onDelta): LlmResponse
            {
                $step = $this->next();

                foreach (mb_str_split($step->text, 4) as $chunk) {
                    $onDelta($chunk);
                }

                return $step;
            }

            private function next(): LlmResponse
            {
                $step = array_shift($this->script) ?? new LlmResponse(text: 'Hotovo.');

                if ($step instanceof LlmException) {
                    throw $step;
                }

                return $step;
            }
        };

        $this->app->instance(OllamaProvider::class, $fake);

        return $fake;
    }
}
