<?php

namespace Tests\Feature;

use App\Http\Middleware\AuthenticateConsoleToken;
use App\Models\ConsoleThread;
use App\Services\Llm\LlmProvider;
use App\Services\Llm\LlmResponse;
use App\Services\Llm\OllamaProvider;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Programový okruh konzoly tak, ako je NAOZAJ zaregistrovaný v routes/api.php.
 *
 * Prečo vlastná sada, keď `ConsoleProgrammaticTest` guard aj runner testuje:
 * tá si routy registruje sama, takže by prešla aj vtedy, keby v `routes/api.php`
 * nebol ani jeden riadok a alias `auth.console` v `bootstrap/app.php` chýbal.
 * Zapojenie je presne to miesto, kde sa chyba schová — chýbajúci alias je 500,
 * nie 401, a zabudnutá routa je 404, ktoré vyzerá ako „ešte nie je hotové".
 */
class ConsoleCliRoutesTest extends TestCase
{
    use RefreshDatabase;

    /** @var list<string> každá routa okruhu, aby na žiadnu nezabudol zámok */
    private const LOCKED = [
        ['post', '/api/console/headless'],
        ['post', '/api/console/cli/run'],
        ['post', '/api/console/cli/decide'],
        ['get', '/api/console/cli/threads'],
        ['post', '/api/console/cli/threads'],
        ['get', '/api/console/cli/models'],
    ];

    public function test_every_programmatic_route_is_locked_without_the_token(): void
    {
        foreach (self::LOCKED as [$method, $url]) {
            // Default hlavička z Tests\TestCase je TÁ ISTÁ, ktorou sa okruh
            // odomyká — bez jej zhodenia by táto sada prešla aj s rozbitým guardom.
            $this->flushHeaders();

            $response = $this->json(strtoupper($method), $url, []);

            $this->assertSame(401, $response->status(), "{$method} {$url} musí byť bez tokenu 401");
        }
    }

    public function test_a_wrong_token_does_not_open_the_circuit(): void
    {
        $this->flushHeaders();

        $this->withHeader(AuthenticateConsoleToken::HEADER, 'nie-ten-token')
            ->getJson('/api/console/cli/threads')
            ->assertStatus(401);
    }

    public function test_a_proxied_request_is_refused_even_with_the_right_token(): void
    {
        // Toto je jadro okruhu: Caddy na verejnej ceste hlavičku s UI tokenom do
        // requestov VKLADÁ, takže bez tejto kontroly by bol ngrok tunel plne
        // autentizovaný vstup bez CSRF k tooolom, ktoré spúšťajú príkazy.
        $this->withHeader('X-Forwarded-For', '203.0.113.7')
            ->getJson('/api/console/cli/threads')
            ->assertStatus(403);
    }

    public function test_threads_and_models_are_readable_with_the_token(): void
    {
        ConsoleThread::create(['title' => 'staré vlákno']);

        $this->getJson('/api/console/cli/threads')
            ->assertOk()
            ->assertJsonFragment(['title' => 'staré vlákno']);

        $this->getJson('/api/console/cli/models')->assertOk();
    }

    public function test_a_thread_is_reachable_by_uuid_and_an_unknown_uuid_is_not_a_leak(): void
    {
        $thread = ConsoleThread::create(['title' => 'vlákno']);

        $this->getJson('/api/console/cli/threads/'.$thread->uuid)
            ->assertOk()
            ->assertJsonFragment(['uuid' => $thread->uuid]);

        // Bez tokenu musí prísť 401, NIE 404 — poradie middleware pred
        // SubstituteBindings je práve na to (viď bootstrap/app.php).
        $this->flushHeaders();
        $this->getJson('/api/console/cli/threads/'.\Illuminate\Support\Str::uuid())
            ->assertStatus(401);
    }

    public function test_headless_run_answers_with_json_and_never_streams(): void
    {
        $this->fakeProvider('Vedomie má 2 673 uzlov.');

        $response = $this->postJson('/api/console/headless', ['message' => 'Koľko uzlov máš?']);

        $response->assertOk()
            ->assertJsonStructure(['thread', 'text', 'tokens_out'])
            ->assertJsonPath('text', 'Vedomie má 2 673 uzlov.');

        $this->assertStringContainsString('application/json', (string) $response->headers->get('Content-Type'));
    }

    public function test_a_failed_headless_run_is_not_a_success(): void
    {
        // Neznáme vlákno: runner ho odmieta a nezakladá nové (volajúci by dostal
        // odpoveď bez kontextu a nemal ako zistiť prečo).
        $this->postJson('/api/console/headless', [
            'message' => 'ahoj',
            'thread' => (string) \Illuminate\Support\Str::uuid(),
        ])->assertStatus(422)->assertJsonStructure(['error']);
    }

    public function test_headless_validates_before_it_ever_reaches_the_model(): void
    {
        $this->postJson('/api/console/headless', [])->assertStatus(422);
        $this->postJson('/api/console/headless', ['message' => str_repeat('a', 8001)])->assertStatus(422);
    }

    /** Poskytovateľ, ktorý odpovie hneď — bez neho by sada čakala na CPU inferenciu. */
    private function fakeProvider(string $text): void
    {
        $this->app->instance(OllamaProvider::class, new class($text) implements LlmProvider
        {
            public function __construct(private string $text) {}

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
                return new LlmResponse(text: $this->text, tokensIn: 12, tokensOut: 8);
            }

            public function stream(array $messages, array $options, callable $onDelta): LlmResponse
            {
                $onDelta($this->text);

                return new LlmResponse(text: $this->text, tokensIn: 12, tokensOut: 8);
            }
        });
    }
}
