<?php

namespace Tests\Feature;

use App\Http\Middleware\AuthenticateConsoleToken;
use App\Models\ConsoleMessage;
use App\Models\ConsoleThread;
use App\Services\Console\HeadlessRunner;
use App\Services\Console\ToolRegistry;
use App\Services\Llm\LlmException;
use App\Services\Llm\LlmProvider;
use App\Services\Llm\LlmResponse;
use App\Services\Llm\OllamaProvider;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Programový vstup do konzoly: token okruh pre neprehliadačových klientov,
 * headless beh a MCP tooly nad ním.
 *
 * Žiadny test nezavolá skutočný model. Poskytovateľ je fake naviazaný do
 * kontejnera namiesto {@see OllamaProvider} — ten istý mechanizmus, na ktorom
 * stojí {@see ConsoleRunTest}; register toolov je tu naopak SKUTOČNÝ, pretože
 * práve „ktoré tooly headless beh ponúkne" je jedna z overovaných vlastností.
 *
 * Pasca: {@see TestCase} posiela hlavičku UI tokenu ako default na každom
 * requeste, a je to TÁ ISTÁ hlavička, akú číta {@see AuthenticateConsoleToken}.
 * Testy o zamknutí si ju preto musia zhodiť cez `flushHeaders()`, inak merajú
 * odomknutý okruh a prejdú aj s rozbitým guardom.
 */
class ConsoleProgrammaticTest extends TestCase
{
    use RefreshDatabase;

    /** Testovacia routa za guardom — do routes/api.php sa kvôli testu nesiaha. */
    private const ROUTE = '/api/test/console-token';

    protected function setUp(): void
    {
        parent::setUp();

        config(['cache.default' => 'array']);
        config(['hades.console.provider' => 'ollama']);
        config(['hades.mcp_token' => 'test-mcp-token']);

        Route::post(self::ROUTE, fn () => response()->json(['passed' => true]))
            ->middleware(AuthenticateConsoleToken::class);
    }

    // ---- token okruh -------------------------------------------------------

    public function test_request_without_the_token_header_is_rejected(): void
    {
        $this->flushHeaders();

        $this->postJson(self::ROUTE)->assertStatus(401);
    }

    public function test_wrong_token_is_rejected(): void
    {
        $this->flushHeaders();

        $this->withHeader(AuthenticateConsoleToken::HEADER, 'nie-ten-token')
            ->postJson(self::ROUTE)
            ->assertStatus(401);
    }

    public function test_correct_token_from_loopback_passes(): void
    {
        $this->postJson(self::ROUTE)
            ->assertOk()
            ->assertJson(['passed' => true]);
    }

    /**
     * Toto je dôvod, prečo guard existuje. Caddy pred ngrok tunelom hlavičku s UI
     * tokenom do requestov VKLADÁ, takže samotný token o pôvode requestu nehovorí
     * nič — a bez tejto kontroly by bol tunel automaticky autentizovaným vstupom
     * bez CSRF do endpointu, ktorý spúšťa tooly nad pamäťou a súbormi.
     */
    public function test_forwarded_request_is_refused_even_with_the_right_token(): void
    {
        $this->withHeader('X-Forwarded-For', '203.0.113.7')
            ->postJson(self::ROUTE)
            ->assertStatus(403);

        $this->withHeader('X-Forwarded-Host', 'hades.ngrok.app')
            ->postJson(self::ROUTE)
            ->assertStatus(403);
    }

    public function test_request_from_a_non_loopback_address_is_refused(): void
    {
        $this->withServerVariables(['REMOTE_ADDR' => '10.0.0.9'])
            ->postJson(self::ROUTE)
            ->assertStatus(403);
    }

    /** Nenakonfigurovaný server je zamknutý server — fail-closed ako všade inde. */
    public function test_empty_ui_token_locks_the_programmatic_route(): void
    {
        config(['hades.ui_token' => '']);

        $this->postJson(self::ROUTE)->assertStatus(401);
    }

    // ---- headless beh ------------------------------------------------------

    /**
     * Sada headless behu nesmie obsahovať ani jeden zápisový tool: zápis parkuje
     * ťah rámcom `permission` a pri programovom behu ho nemá kto povoliť, takže
     * vlákno by zamrzlo natrvalo.
     *
     * Počíta sa to z `isWrite()`, nie zo zoznamu mien — inak by test prešiel aj
     * po tom, čo do `ToolRegistry::TOOLS` pribudne nový zápisový tool.
     */
    public function test_headless_registry_offers_no_write_tools(): void
    {
        $registry = app(HeadlessRunner::class)->registry();

        $this->assertNotEmpty($registry->names(), 'Headless beh bez toolov by bol len chat.');

        foreach ($registry->names() as $name) {
            $this->assertFalse($registry->isWrite($name), "Tool {$name} zapisuje a v headless sade nemá čo robiť.");
        }

        // sada je naozaj PODMNOŽINA kánonu, nie jeho kópia
        $this->assertLessThan(count(ToolRegistry::TOOLS), count($registry->names()));
    }

    public function test_headless_run_returns_text_tokens_and_a_reusable_thread(): void
    {
        $this->fakeProvider([
            new LlmResponse(text: 'Mám 2673 uzlov.', tokensIn: 210, tokensOut: 9, durationMs: 1200, model: 'fake:1', evalDurationMs: 900),
        ]);

        $result = app(HeadlessRunner::class)->run('Koľko máš uzlov?');

        $this->assertSame('Mám 2673 uzlov.', $result['text']);
        $this->assertSame(9, $result['tokens_out']);
        $this->assertSame(210, $result['tokens_in']);
        $this->assertSame(LlmResponse::STOP_END_TURN, $result['stop_reason']);
        $this->assertSame(1, $result['steps']);
        $this->assertArrayNotHasKey('error', $result);

        // `thread` musí byť použiteľný na pokračovanie, nie dekorácia
        $thread = ConsoleThread::where('uuid', $result['thread'])->first();
        $this->assertNotNull($thread);
        $this->assertDatabaseHas('console_messages', [
            'thread_id' => $thread->id,
            'role' => 'user',
            'content' => 'Koľko máš uzlov?',
        ]);
    }

    public function test_headless_run_continues_an_existing_thread(): void
    {
        $this->fakeProvider([new LlmResponse(text: 'Prvá.'), new LlmResponse(text: 'Druhá.')]);

        $runner = app(HeadlessRunner::class);
        $first = $runner->run('Otázka jeden');
        $second = $runner->run('Otázka dva', $first['thread']);

        $this->assertSame($first['thread'], $second['thread']);
        $this->assertSame('Druhá.', $second['text']);
        $this->assertSame(1, ConsoleThread::count());
    }

    /**
     * Nebežiaca Ollama je najčastejšia porucha programového behu a nesmie z nej
     * byť výnimka — volajúci je skript alebo iná AI a potrebuje odpoveď, z ktorej
     * sa dá pokračovať.
     */
    public function test_provider_failure_comes_back_as_an_error_field(): void
    {
        $this->failingProvider('Ollama neodpovedá na http://localhost:11434.');

        $result = app(HeadlessRunner::class)->run('Ahoj');

        $this->assertArrayHasKey('error', $result);
        $this->assertStringContainsString('Ollama', $result['error']);
        $this->assertArrayNotHasKey('text', $result);
    }

    // ---- MCP tooly ---------------------------------------------------------

    public function test_mcp_console_run_returns_the_thread_and_the_text(): void
    {
        $this->fakeProvider([new LlmResponse(text: 'Hotovo.', tokensIn: 90, tokensOut: 4)]);

        $data = $this->callTool('console_run', ['message' => 'Zisti niečo']);

        $this->assertSame('Hotovo.', $data['text']);
        $this->assertNotNull(ConsoleThread::where('uuid', $data['thread'])->first());
        $this->assertSame(4, $data['tokens_out']);
    }

    public function test_mcp_console_run_requires_a_message(): void
    {
        $res = $this->rpc('tools/call', ['name' => 'console_run', 'arguments' => []])->assertOk();

        $this->assertTrue($res->json('result.isError'));
        $this->assertStringContainsString('message', $res->json('result.content.0.text'));
    }

    public function test_mcp_console_threads_clamps_the_limit_to_the_server_cap(): void
    {
        foreach (range(1, 51) as $i) {
            ConsoleThread::create(['title' => "Vlákno {$i}", 'last_message_at' => now()->subMinutes(51 - $i)]);
        }

        $this->assertCount(50, $this->callTool('console_threads', ['limit' => 999])['threads']);
        $this->assertCount(1, $this->callTool('console_threads', ['limit' => 0])['threads']);
        $this->assertCount(3, $this->callTool('console_threads', ['limit' => 3])['threads']);

        // `total` musí povedať, že strop niečo odrezal
        $this->assertSame(51, $this->callTool('console_threads', ['limit' => 3])['total']);
    }

    public function test_mcp_console_result_reads_the_tail_and_clamps_the_limit(): void
    {
        $thread = ConsoleThread::create(['title' => 'Dlhé vlákno']);

        // smernica sa do odpovede vracať nesmie — je to ten istý text na každom vlákne
        ConsoleMessage::create(['thread_id' => $thread->id, 'role' => 'system', 'content' => 'SMERNICA']);

        foreach (range(1, 60) as $i) {
            ConsoleMessage::create([
                'thread_id' => $thread->id,
                'role' => $i % 2 === 0 ? 'assistant' : 'user',
                'content' => "replika {$i}",
            ]);
        }

        $data = $this->callTool('console_result', ['thread' => $thread->uuid, 'limit' => 999]);

        $this->assertCount(50, $data['messages']);
        $this->assertSame('replika 60', $data['messages'][49]['content']);
        $this->assertSame('replika 11', $data['messages'][0]['content'], 'Má sa vracať CHVOST, nie začiatok.');
        $this->assertStringNotContainsString('SMERNICA', json_encode($data, JSON_UNESCAPED_UNICODE));

        $this->assertCount(1, $this->callTool('console_result', ['thread' => $thread->uuid, 'limit' => 0])['messages']);
    }

    /** Rez v dlhej správe sa priznáva — inak by AI čítala odseknutý text ako celý. */
    public function test_mcp_console_result_admits_a_truncated_message(): void
    {
        $thread = ConsoleThread::create([]);
        ConsoleMessage::create([
            'thread_id' => $thread->id,
            'role' => 'assistant',
            'content' => str_repeat('a', 4000),
        ]);

        $message = $this->callTool('console_result', ['thread' => $thread->uuid])['messages'][0];

        $this->assertTrue($message['content_truncated']);
        $this->assertSame(1500, mb_strlen($message['content']));
    }

    public function test_mcp_console_result_refuses_an_unknown_thread(): void
    {
        $res = $this->rpc('tools/call', [
            'name' => 'console_result',
            'arguments' => ['thread' => '00000000-0000-0000-0000-000000000000'],
        ])->assertOk();

        $this->assertTrue($res->json('result.isError'));
    }

    public function test_mcp_tools_list_exposes_the_three_console_tools(): void
    {
        $names = collect($this->rpc('tools/list')->assertOk()->json('result.tools'))->pluck('name');

        foreach (['console_run', 'console_threads', 'console_result'] as $tool) {
            $this->assertTrue($names->contains($tool), "V tools/list chýba {$tool}.");
        }
    }

    // ---- pomôcky -----------------------------------------------------------

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
     * Fake poskytovateľ na miesto Ollamy. `ProviderFactory` si ho berie z
     * kontejnera, takže netreba podstrkovať celú fabriku.
     *
     * @param  list<LlmResponse>  $script
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
                return $this->next(null);
            }

            public function stream(array $messages, array $options, callable $onDelta): LlmResponse
            {
                return $this->next($onDelta);
            }

            private function next(?callable $onDelta): LlmResponse
            {
                $step = array_shift($this->script) ?? new LlmResponse(text: 'Hotovo.');

                // deltá po štvoriciach znakov — text vo výsledku je ich súčet
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

    /** Poskytovateľ, ktorý padne tak, ako padá nebežiaca Ollama. */
    private function failingProvider(string $message): void
    {
        $fake = new class($message) implements LlmProvider
        {
            public function __construct(private string $message) {}

            public function name(): string
            {
                return OllamaProvider::NAME;
            }

            public function models(): array
            {
                return [];
            }

            public function available(): bool
            {
                return false;
            }

            public function chat(array $messages, array $options = []): LlmResponse
            {
                throw new LlmException($this->message);
            }

            public function stream(array $messages, array $options, callable $onDelta): LlmResponse
            {
                throw new LlmException($this->message);
            }
        };

        $this->app->instance(OllamaProvider::class, $fake);
    }
}
