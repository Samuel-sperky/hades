<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * CORS whitelist (rozhodnutie #23) a zmazaný `POST /debug/snapshot`
 * (rozhodnutie #24).
 *
 * Do W2 `config/cors.php` neexistoval, takže platil framework default
 * `allowed_origins => ['*']` na všetkých `/api/*` — vrátane zápisových
 * (`POST /api/nodes`, `DELETE /api/nodes/{id}`, `POST /api/chat`). Ktorákoľvek
 * stránka na internete tak mohla z prehliadača používateľa čítať aj mazať jeho
 * dlhodobú pamäť.
 */
class HttpSecurityTest extends TestCase
{
    use RefreshDatabase;

    private const FOREIGN_ORIGIN = 'https://nie-nasa-domena.example';

    /** Prvý povolený origin z whitelistu — test tak nezávisí od APP_URL v .env. */
    private function allowedOrigin(): string
    {
        $origins = (array) config('cors.allowed_origins');
        $this->assertNotEmpty($origins, 'whitelist nesmie byť prázdny, inak CORS nikdy neprejde');

        return (string) $origins[0];
    }

    // ---- konfigurácia -------------------------------------------------------

    public function test_cors_config_has_no_wildcard_anywhere(): void
    {
        $this->assertNotContains('*', (array) config('cors.allowed_origins'));
        $this->assertSame([], (array) config('cors.allowed_origins_patterns'));
        $this->assertNotContains('*', (array) config('cors.allowed_headers'));

        // s úzkym whitelistom by credentials otvorili cross-site zápis so session
        $this->assertFalse((bool) config('cors.supports_credentials'));
    }

    public function test_cors_covers_api_and_mcp_paths(): void
    {
        $paths = (array) config('cors.paths');

        $this->assertContains('api/*', $paths);
        $this->assertContains('mcp', $paths, '/mcp bez CORS pravidla by dedil framework default');
    }

    // ---- reálne hlavičky ----------------------------------------------------

    public function test_foreign_origin_gets_no_allow_origin_header(): void
    {
        $res = $this->getJson('/api/mind', ['Origin' => self::FOREIGN_ORIGIN])->assertOk();

        $this->assertNull(
            $res->headers->get('Access-Control-Allow-Origin'),
            'cudzia origin nesmie dostať povolenie — prehliadač jej odpoveď zahodí',
        );
    }

    public function test_allowed_origin_is_echoed_never_starred(): void
    {
        $origin = $this->allowedOrigin();

        $res = $this->getJson('/api/mind', ['Origin' => $origin])->assertOk();

        $this->assertSame($origin, $res->headers->get('Access-Control-Allow-Origin'));
    }

    public function test_write_endpoints_are_not_open_cross_origin(): void
    {
        foreach ([['DELETE', '/api/nodes/1'], ['POST', '/api/nodes'], ['POST', '/api/chat']] as [$method, $path]) {
            $res = $this->call('OPTIONS', $path, [], [], [], [
                'HTTP_ORIGIN' => self::FOREIGN_ORIGIN,
                'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => $method,
            ]);

            $this->assertNull(
                $res->headers->get('Access-Control-Allow-Origin'),
                "{$method} {$path} nesmie povoliť cudziu origin",
            );
        }
    }

    public function test_same_origin_request_without_origin_header_still_works(): void
    {
        // SPA beží na tej istej origin, takže Origin hlavičku vôbec neposiela —
        // CORS ju nesmie ovplyvniť
        $this->getJson('/api/mind')->assertOk();
    }

    // ---- zmazaný debug endpoint --------------------------------------------

    /**
     * `POST /debug/snapshot` bral base64 obrázok, zapisoval ho pod menom od
     * používateľa do storage/app/ a mal VYPNUTÝ CSRF, žiadny throttle a žiadny
     * strop veľkosti. Registrovaný bol len v `local`, ale appka sa v lokálnom
     * režime verejne tuneluje.
     */
    public function test_debug_snapshot_route_does_not_exist(): void
    {
        $uris = collect(Route::getRoutes()->getRoutes())
            ->map(fn ($route): string => $route->uri())
            ->all();

        $this->assertNotContains('debug/snapshot', $uris);

        foreach ($uris as $uri) {
            $this->assertStringNotContainsString('debug/', $uri, "debug routa {$uri} nemá byť registrovaná");
        }
    }
}
