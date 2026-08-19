<?php

namespace Tests\Feature;

use App\Models\ConsoleThread;
use App\Services\Console\AgentRunner;
use App\Services\Console\CommandCage;
use App\Services\Console\ToolRegistry;
use App\Services\Console\Tools\BashTool;
use App\Services\Console\Tools\NarrowsAllowance;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * „Povoliť vždy" pri shelle sa smie zúžiť na vzor príkazu — a NESMIE otvoriť
 * zvyšok zápisových toolov.
 *
 * Prečo na to je vlastná sada: `bash` pribudol do registra 19. 8. 2026 a s ním
 * riziko, ktoré predtým neexistovalo. Dovtedy bolo `allow_always` obhájiteľné aj
 * ako plošné — argumenty pamäťových a súborových toolov sú z uzavretej množiny
 * (uzol, cesta v repe). Argument shellu je celý jazyk, takže jedno kliknutie pri
 * `php artisan test` by v tom vlákne povolilo aj `mind_delete`. Táto sada je
 * poistka proti tomu, aby sa to niekedy „zjednodušilo" späť.
 */
class ConsoleAllowanceTest extends TestCase
{
    use RefreshDatabase;

    public function test_bash_narrows_allowance_to_the_command_pattern(): void
    {
        $tool = app(BashTool::class);

        $this->assertInstanceOf(NarrowsAllowance::class, $tool);
        $this->assertSame('php artisan test', $tool->allowanceKey(['command' => 'php artisan test --filter Foo']));
        $this->assertSame('git status', $tool->allowanceKey(['command' => 'git status --short']));

        // Chýbajúci argument nesmie vrátiť kľúč, na ktorý by sa dalo povoliť
        // čokoľvek — fail-closed.
        $this->assertNull($tool->allowanceKey([]));
        $this->assertNull($tool->allowanceKey(['command' => '   ']));
    }

    public function test_registry_reports_which_tools_narrow(): void
    {
        $registry = app(ToolRegistry::class);

        $this->assertTrue($registry->narrowsAllowance('bash'));
        $this->assertFalse($registry->narrowsAllowance('write_file'));
        $this->assertFalse($registry->narrowsAllowance('mind_delete'));

        // Neznámy tool nezužuje — a `drain()` ho aj tak nevykoná.
        $this->assertFalse($registry->narrowsAllowance('nope'));

        $this->assertSame(
            'php artisan test',
            $registry->allowanceKey('bash', ['command' => 'php artisan test'])
        );
        $this->assertNull($registry->allowanceKey('write_file', ['path' => 'a.txt', 'content' => 'x']));
    }

    public function test_allow_always_on_bash_does_not_open_the_other_write_tools(): void
    {
        $thread = ConsoleThread::create(['title' => 'test']);
        $call = $this->pendingCall($thread, 'bash', ['command' => 'php artisan test --filter Foo']);

        $this->decide($thread, $call, AgentRunner::DECISION_ALLOW_ALWAYS);

        $thread->refresh();

        // TOTO je jadro celej sady: plošné povolenie sa nezapne.
        $this->assertFalse($thread->auto_accept, 'allow_always pri bash NESMIE zapnúť auto_accept');
        $this->assertTrue($thread->allowsTool('bash', 'php artisan test'));
        $this->assertFalse($thread->allowsTool('bash', 'git status'));
        $this->assertFalse($thread->allowsTool('write_file', 'php artisan test'));
    }

    public function test_allow_always_on_other_tools_still_sets_auto_accept(): void
    {
        // Fake tool, nie skutočný `write_file`: rozhodnutie „povoliť" tool aj
        // VYKONÁ, takže prvá verzia tohto testu naozaj zapísala `a.txt` do korena
        // repozitára. Test, ktorý po sebe nechá súbor v pracovnom priečinku, sa
        // raz commitne s ním.
        $this->app->instance(ToolRegistry::class, new ToolRegistry([$this->fakeWriteTool()]));

        $thread = ConsoleThread::create(['title' => 'test']);
        $call = $this->pendingCall($thread, 'fake_write', ['path' => 'a.txt', 'content' => 'x']);

        $this->decide($thread, $call, AgentRunner::DECISION_ALLOW_ALWAYS);

        // Správanie, ktoré tu bolo pred `bash`, zostáva — táto zmena je aditívna,
        // nie prepis pravidiel pre všetky tooly.
        $this->assertTrue($thread->refresh()->auto_accept);
    }

    public function test_a_remembered_pattern_runs_without_asking_and_a_new_one_asks(): void
    {
        $thread = ConsoleThread::create(['title' => 'test']);
        $thread->allowTool('bash', 'php artisan test');
        $thread->save();

        $cage = app(CommandCage::class);
        $registry = app(ToolRegistry::class);

        // Povolený vzor: kľúč sedí, teda sa nemá parkovať.
        $key = $registry->allowanceKey('bash', ['command' => 'php artisan test --filter Bar']);
        $this->assertSame('php artisan test', $key);
        $this->assertTrue($thread->allowsTool('bash', $key));

        // Iný vzor toho istého toolu — povolenie naň neplatí.
        $other = $registry->allowanceKey('bash', ['command' => 'git diff']);
        $this->assertSame('git diff', $other);
        $this->assertFalse($thread->allowsTool('bash', $other));

        // A vzor sa počíta z klietky, nie z celého príkazu — inak by povolenie
        // platilo len na znak-za-znakom rovnaký príkaz a bolo by na nič.
        $this->assertSame('php artisan test', $cage->pattern('php artisan test --filter Whatever'));
    }

    public function test_allowances_survive_a_reload_of_the_thread(): void
    {
        $thread = ConsoleThread::create(['title' => 'test']);
        $thread->allowTool('bash', 'git status');
        $thread->allowTool('bash', 'git status');   // idempotentné
        $thread->save();

        $fresh = ConsoleThread::where('uuid', $thread->uuid)->firstOrFail();

        $this->assertSame(['bash' => ['git status']], $fresh->allowances);
        $this->assertTrue($fresh->allowsTool('bash', 'git status'));
    }

    /**
     * Zápisový tool, ktorý zúženie NEponúka — teda taký, pri ktorom „povoliť
     * vždy" má naďalej znamenať plošné `auto_accept`.
     *
     * Implementuje `ConsoleTool` priamo (nie cez `BaseTool`), rovnako ako fake
     * tooly v `ConsoleRunTest`: je to zároveň dôkaz, že marker `NarrowsAllowance`
     * nie je pre ostatné tooly povinný.
     */
    private function fakeWriteTool(): \App\Services\Console\Tools\ConsoleTool
    {
        return new class implements \App\Services\Console\Tools\ConsoleTool
        {
            public function name(): string
            {
                return 'fake_write';
            }

            public function description(): string
            {
                return 'fake write tool';
            }

            public function schema(): array
            {
                return ['type' => 'object', 'properties' => [], 'required' => []];
            }

            public function isWrite(): bool
            {
                return true;
            }

            public function preview(array $args): ?string
            {
                return 'náhľad';
            }

            public function execute(array $args): \App\Services\Console\ToolResult
            {
                // Nič nezapisuje: test sa pýta na povolenie, nie na zápis.
                return \App\Services\Console\ToolResult::ok('hotovo');
            }
        };
    }

    /**
     * Zaparkovaný tool call, ako ho vyrobí smyčka. Priamo cez model, nie cez
     * beh: rozhodnutie sa testuje samo za seba a nepotrebuje poskytovateľa.
     *
     * @param  array<string, mixed>  $arguments
     */
    private function pendingCall(ConsoleThread $thread, string $name, array $arguments): \App\Models\ConsoleToolCall
    {
        $message = \App\Models\ConsoleMessage::create([
            'thread_id' => $thread->id,
            'role' => 'assistant',
            'content' => '',
        ]);

        return \App\Models\ConsoleToolCall::create([
            'thread_id' => $thread->id,
            'message_id' => $message->id,
            'call_id' => 'call_'.$name,
            'name' => $name,
            'arguments' => $arguments,
            'status' => 'pending',
        ]);
    }

    /**
     * Zavolá `resume()` a rámce zahodí — testuje sa dôsledok rozhodnutia na
     * vlákno, nie prúd.
     *
     * Poskytovateľ sa podstrkuje a hneď hádže: bez toho si `resume()` vypýta
     * odpoveď od SKUTOČNEJ Ollamy. Zmerané pred touto zmenou — sada bežala 1 min
     * 57 s namiesto sekúnd, a keby Ollama na stroji naozaj bežala, test by
     * generoval odpoveď lokálnym modelom a jeho výsledok by závisel od toho, čo
     * model povie. `guarded()` výnimku preloží na rámec `error` a vlákno zostane
     * presne v stave, ktorý nás zaujíma.
     */
    private function decide(ConsoleThread $thread, \App\Models\ConsoleToolCall $call, string $decision): void
    {
        $this->app->instance(\App\Services\Llm\OllamaProvider::class, new class implements \App\Services\Llm\LlmProvider
        {
            public function name(): string
            {
                return \App\Services\Llm\OllamaProvider::NAME;
            }

            public function models(): array
            {
                return [];
            }

            public function available(): bool
            {
                return true;
            }

            public function chat(array $messages, array $options = []): \App\Services\Llm\LlmResponse
            {
                throw new \App\Services\Llm\ProviderUnavailableException('fake: model sa v tomto teste nepýta');
            }

            public function stream(array $messages, array $options, callable $onDelta): \App\Services\Llm\LlmResponse
            {
                throw new \App\Services\Llm\ProviderUnavailableException('fake: model sa v tomto teste nepýta');
            }
        });

        app(AgentRunner::class)->resume($thread, $call, $decision, static function (array $frame): void {});
    }
}
