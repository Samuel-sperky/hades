<?php

namespace Tests\Feature;

use App\Http\Middleware\AuthenticateUi;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Guard nad UI okruhom — dashboard `/` aj interné `/api/*` (13. 8. 2026).
 *
 * Predtým interné `/api/*` nechránilo nič okrem bindingu na 127.0.0.1:8080, teda
 * to isté „nič" ako `/mcp` do 12. 8. 2026: ktorýkoľvek lokálny proces vrátane
 * cudzích docker kontajnerov vedel čítať celú pamäť aj zapisovať do nej. Na
 * `api` routách navyše nebolo CSRF, takže zápis prepasovala aj cudzia stránka
 * otvorená v prehliadači.
 *
 * Dashboard musí byť pod guardom spolu s API — inak by ochrana nefungovala:
 * lokálny proces si spraví `GET /` a token aj CSRF si z HTML vyparsuje.
 */
class AuthenticateUiTest extends TestCase
{
    use RefreshDatabase;

    private const READ = '/api/mind/stats';

    protected function setUp(): void
    {
        parent::setUp();

        config(['cache.default' => 'array']);
    }

    /** Zhodí default odomykaciu hlavičku z Tests\TestCase — request je „cudzí proces". */
    private function locked(): static
    {
        $this->flushHeaders();

        return $this;
    }

    /** Odtlačok tokenu tak, ako ho drží session. */
    private function fingerprint(string $token = self::UI_TOKEN): string
    {
        return hash('sha256', $token);
    }

    /**
     * ValidateCsrfToken sa v testoch sám vypína (`runningUnitTests()`), takže bez
     * tohto by CSRF vetva nikdy neprešla testom. Podstrčíme podtriedu, ktorá sa
     * tvári, že testy nebežia.
     */
    private function enforceCsrf(): void
    {
        $this->app->singleton(ValidateCsrfToken::class, fn ($app) => new class($app, $app['encrypter']) extends ValidateCsrfToken
        {
            protected function runningUnitTests(): bool
            {
                return false;
            }
        });
    }

    // ---- čítanie a zápis bez odomknutia ------------------------------------

    public function test_read_without_unlock_is_rejected(): void
    {
        $this->locked()->getJson(self::READ)->assertStatus(401);
    }

    public function test_write_without_unlock_is_rejected(): void
    {
        $this->locked()->postJson('/api/nodes', ['label' => 'Cudzí zápis'])->assertStatus(401);

        $this->assertDatabaseMissing('nodes', ['label' => 'Cudzí zápis']);
    }

    public function test_destructive_write_without_unlock_is_rejected(): void
    {
        $this->locked()->deleteJson('/api/nodes/1')->assertStatus(401);
        $this->locked()->putJson('/api/departments/1', ['name' => 'X'])->assertStatus(401);
    }

    public function test_guard_runs_before_route_model_binding(): void
    {
        // 404 namiesto 401 by prezradilo, ktoré id v pamäti existujú
        $this->locked()->getJson('/api/nodes/999999')->assertStatus(401);
    }

    public function test_dashboard_itself_is_locked(): void
    {
        $this->locked()->get('/')->assertStatus(401);
    }

    public function test_wrong_token_is_rejected(): void
    {
        $this->locked()->withHeader(AuthenticateUi::HEADER, 'nespravny-token')
            ->getJson(self::READ)->assertStatus(401);

        $this->locked()->getJson(self::READ.'?token=nespravny-token')->assertStatus(401);
    }

    // ---- cesty dovnútra ----------------------------------------------------

    public function test_header_token_unlocks_for_caddy_path(): void
    {
        // hlavičku vkladá Caddy na verejnej ceste za basic-auth (docker/Caddyfile)
        $this->locked()->withHeader(AuthenticateUi::HEADER, self::UI_TOKEN)
            ->getJson(self::READ)->assertOk();
    }

    public function test_query_token_unlocks_dashboard_and_strips_itself_from_url(): void
    {
        $res = $this->locked()->get('/?token='.self::UI_TOKEN);

        $res->assertRedirect('/');
        $res->assertSessionHas(AuthenticateUi::SESSION_KEY, $this->fingerprint());
    }

    public function test_query_token_keeps_other_query_parameters(): void
    {
        $this->locked()->get('/?token='.self::UI_TOKEN.'&scope=area')
            ->assertRedirect('/?scope=area');
    }

    public function test_unlocked_session_is_enough(): void
    {
        $this->locked()
            ->withSession([AuthenticateUi::SESSION_KEY => $this->fingerprint()])
            ->getJson(self::READ)->assertOk();
    }

    public function test_rotating_the_token_invalidates_old_sessions(): void
    {
        config(['hades.ui_token' => 'novy-token-po-rotacii']);

        $this->locked()
            ->withSession([AuthenticateUi::SESSION_KEY => $this->fingerprint()])
            ->getJson(self::READ)->assertStatus(401);
    }

    public function test_guard_is_fail_closed_when_token_is_not_configured(): void
    {
        config(['hades.ui_token' => '']);

        // ani správne vyzerajúci token neprejde, keď server žiadny nemá
        $this->withHeader(AuthenticateUi::HEADER, self::UI_TOKEN)
            ->getJson(self::READ)->assertStatus(401);
        $this->locked()->getJson(self::READ)->assertStatus(401);
        $this->locked()->get('/')->assertStatus(401);
    }

    // ---- CSRF na zápisoch --------------------------------------------------

    public function test_write_without_csrf_token_is_rejected(): void
    {
        $this->enforceCsrf();

        // odomknuté (default hlavička), ale bez CSRF tokenu → 419
        $this->postJson('/api/nodes', ['label' => 'Bez CSRF'])->assertStatus(419);

        $this->assertDatabaseMissing('nodes', ['label' => 'Bez CSRF']);
    }

    public function test_write_with_csrf_token_passes(): void
    {
        $this->enforceCsrf();

        $this->withSession(['_token' => 'csrf-token-testu'])
            ->postJson('/api/nodes', ['label' => 'S CSRF'], ['X-CSRF-TOKEN' => 'csrf-token-testu'])
            ->assertCreated();

        $this->assertDatabaseHas('nodes', ['label' => 'S CSRF']);
    }

    public function test_guard_answers_before_csrf_when_locked(): void
    {
        $this->enforceCsrf();

        // 401 (zamknuté), nie 419 — poradie middleware v routes/api.php je zámerné
        $this->locked()->postJson('/api/nodes', ['label' => 'Cudzí zápis bez CSRF'])
            ->assertStatus(401);
    }

    public function test_reads_do_not_need_a_csrf_token(): void
    {
        $this->enforceCsrf();

        $this->getJson(self::READ)->assertOk();
    }

    // ---- ostatné okruhy sa nesmú pohnúť ------------------------------------

    public function test_ui_token_does_not_open_the_programmatic_api(): void
    {
        config(['hades.api_token' => 'test-api-token']);

        // UI okruh je zámerne oddelený od /api/v1 — únik jedného tokenu nesmie
        // otvoriť druhý okruh
        $this->withHeader(AuthenticateUi::HEADER, self::UI_TOKEN)
            ->getJson('/api/v1/stats')->assertStatus(401);

        $this->locked()->getJson('/api/v1/stats?token='.self::UI_TOKEN)->assertStatus(401);

        $this->locked()->withHeader('Authorization', 'Bearer test-api-token')
            ->getJson('/api/v1/stats')->assertOk();
    }

    public function test_ui_token_does_not_open_mcp(): void
    {
        config(['hades.mcp_token' => 'test-mcp-token']);

        $this->locked()->withHeader(AuthenticateUi::HEADER, self::UI_TOKEN)
            ->postJson('/mcp', ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'tools/list'])
            ->assertStatus(401);
    }

    public function test_health_stays_open_without_any_token(): void
    {
        // health má byť pinovateľný (§3.2) — guard sa ho nesmie dotknúť
        $this->locked()->getJson('/api/v1/health')->assertOk();
    }
}
