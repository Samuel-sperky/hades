<?php

namespace Tests\Feature;

use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Tests\TestCase;

/**
 * Mazacie routy interného API musia niesť guard aj CSRF.
 *
 * `ConsoleGuardTest` má ten istý vzor pre `api/console/*` a je to presne ten druh
 * testu, ktorý zachytí BUDÚCU chybu: nezoznamuje routy ručne, prejde router
 * a pozrie sa, čo na nich reálne visí. Keď sprint 20. 8. 2026 pridal
 * `DELETE /api/decisions/{decision}` a `DELETE /api/directive/{name}`, ich krytie
 * sa overilo len prečítaním `routes/api.php` — čo nezachytí nikoho, kto o mesiac
 * pridá tretiu mazaciu routu o jednu zátvorku vedľa.
 *
 * Appka je verejne tunelovaná cez ngrok (`docs/BEZPECNOST.md` §8), takže routa,
 * ktorá maže pamäť a vypadne z guardovaného okruhu, je priamo použiteľná zvonku.
 */
class DestructiveRouteGuardTest extends TestCase
{
    /**
     * `/api/v1/*` je samostatný okruh na Bearer token a má vlastné pravidlá;
     * tento test stráži INTERNÝ (UI) okruh, kde je autoritou session + CSRF.
     */
    private const EXTERNAL_PREFIX = 'api/v1';

    public function test_every_destructive_api_route_carries_guard_and_csrf(): void
    {
        $routes = collect(app('router')->getRoutes()->getRoutes())
            ->filter(fn ($route) => str_starts_with($route->uri(), 'api/'))
            ->reject(fn ($route) => str_starts_with($route->uri(), self::EXTERNAL_PREFIX))
            ->filter(fn ($route) => in_array('DELETE', $route->methods(), true));

        $this->assertGreaterThan(
            0,
            $routes->count(),
            'Interné API nemá ani jednu DELETE routu — test by inak prešiel naprázdno.'
        );

        $routes->each(function ($route) {
            $middleware = $route->gatherMiddleware();

            $this->assertContains(
                'auth.ui',
                $middleware,
                "Mazacia routa {$route->uri()} nie je za UI guardom."
            );
            $this->assertContains(
                ValidateCsrfToken::class,
                $middleware,
                "Mazacia routa {$route->uri()} nemá CSRF."
            );
        });
    }

    /**
     * Aj vonkajší (Bearer token) okruh má mazaciu routu — `DELETE /api/v1/knowledge/{node}`.
     *
     * Písal som pôvodne test, ktorý tvrdil, že tam žiadna nie je. Padol: tá routa
     * existuje a je staršia než tento sprint. Nesprávny predpoklad by z testu
     * spravil pascu — pri prvom legitímnom rozšírení by svietil na červeno a nikto
     * by nevedel, či ide o chybu alebo o môj omyl. Test preto stráži to, čo je
     * naozaj pravda: mazanie zvonku smie byť len za tokenom, nikdy voľne.
     */
    public function test_external_delete_routes_require_a_token(): void
    {
        $routes = collect(app('router')->getRoutes()->getRoutes())
            ->filter(fn ($route) => str_starts_with($route->uri(), self::EXTERNAL_PREFIX))
            ->filter(fn ($route) => in_array('DELETE', $route->methods(), true));

        $this->assertGreaterThan(
            0,
            $routes->count(),
            'Vonkajšie API nemá ani jednu DELETE routu — test by inak prešiel naprázdno.'
        );

        $routes->each(function ($route) {
            $this->assertContains(
                'auth.token',
                $route->gatherMiddleware(),
                "Mazacia routa {$route->uri()} je vo vonkajšom okruhu bez tokenu."
            );
        });
    }
}
