<?php

namespace Tests\Feature;

use App\Http\Middleware\AuthenticateUi;
use App\Models\ConsoleThread;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Session\Middleware\StartSession;
use Tests\TestCase;

/**
 * Konzola vedomia (`/console`) je najsilnejší vstup do appky: jej tooly vedia
 * čítať a prepisovať pamäť aj súbory projektu. Preto sedí v tom istom guardovanom
 * okruhu ako dashboard a interné `/api/*` — a preto to testujeme zvlášť.
 *
 * Chyba, na ktorú tento test čaká, je banálna a pravdepodobná: niekto pridá
 * `/api/console/run` MIMO guardovanú skupinu (napr. aby streamovanie „nemuselo
 * riešiť CSRF") a otvorí tým vstup, ktorý spúšťa tooly bez akejkoľvek
 * autentifikácie. Kontrola sa preto pozerá na CELÝ prefix `/api/console/*`,
 * nielen na routy, ktoré dnes existujú.
 */
class ConsoleGuardTest extends TestCase
{
    use RefreshDatabase;

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

    /** ValidateCsrfToken sa v testoch sám vypína; podstrčíme podtriedu, ktorá to nerobí. */
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

    // ---- stránka konzoly ---------------------------------------------------

    public function test_console_page_is_locked(): void
    {
        $this->locked()->get('/console')->assertStatus(401);
    }

    public function test_console_thread_url_is_locked(): void
    {
        $this->locked()->get('/console/'.\Illuminate\Support\Str::uuid())->assertStatus(401);
    }

    public function test_console_page_opens_when_unlocked(): void
    {
        $this->get('/console')->assertOk()->assertSee('Konzola vedomia');
    }

    // ---- API konzoly -------------------------------------------------------

    public function test_thread_listing_is_locked(): void
    {
        $this->locked()->getJson('/api/console/threads')->assertStatus(401);
    }

    public function test_thread_creation_is_locked(): void
    {
        $this->locked()->postJson('/api/console/threads', [])->assertStatus(401);

        $this->assertSame(0, ConsoleThread::count());
    }

    public function test_thread_deletion_is_locked(): void
    {
        $thread = ConsoleThread::create([]);

        $this->locked()->deleteJson('/api/console/threads/'.$thread->uuid)->assertStatus(401);

        $this->assertDatabaseHas('console_threads', ['id' => $thread->id]);
    }

    public function test_guard_runs_before_route_model_binding(): void
    {
        // 404 namiesto 401 by prezradilo, ktoré vlákna existujú
        $this->locked()->getJson('/api/console/threads/'.\Illuminate\Support\Str::uuid())->assertStatus(401);
    }

    /**
     * Každá routa pod `/api/console/` musí sedieť v JEDNOM z dvoch okruhov —
     * a v žiadnom prípade v nijakom.
     *
     * Toto je ten test, ktorý zachytí budúci pridaný endpoint: nezoznamuje ručne,
     * ale prejde router a overí, čo na routách reálne visí.
     *
     * Do 19. 8. 2026 tu bola jedna podmienka („auth.ui + CSRF") a bola správna,
     * lebo konzolu volal len prehliadač. Odvtedy má konzola aj programový vstup
     * pre klienta, ktorý prehliadač NIE JE (terminálový `hades`, desktopové okno,
     * skript, iná AI cez MCP) — a ten session ani CSRF token nemá ako získať.
     *
     * Zoslabenie to nie je, je to iný obchod: `auth.console` je fail-closed na tom
     * istom tajomstve, ale navyše LOOPBACK-ONLY a odmieta všetko, čo prišlo cez
     * proxy (viď AuthenticateConsoleToken). CSRF tam nechýba — v okruhu bez
     * session nemá čo chrániť, pretože niet ambientnej autority, ktorú by cudzia
     * stránka mohla zneužiť.
     *
     * Čo tento test naďalej NEPUSTÍ: routu konzoly bez guardu, a routu v
     * programovom okruhu, ktorá by si zároveň niesla session.
     */
    public function test_every_console_route_sits_in_one_of_the_two_circuits(): void
    {
        $routes = collect(app('router')->getRoutes()->getRoutes())
            ->filter(fn ($route) => str_starts_with($route->uri(), 'api/console'));

        $this->assertGreaterThan(0, $routes->count(), 'Konzola nemá žiadne API routy — test by inak prešiel naprázdno.');

        $ui = 0;
        $programmatic = 0;

        $routes->each(function ($route) use (&$ui, &$programmatic) {
            $middleware = $route->gatherMiddleware();

            if (in_array('auth.console', $middleware, true)) {
                $programmatic++;

                // Programový okruh stojí na tom, že session neexistuje. Keby ju
                // routa mala, mala by ambientnú autoritu bez CSRF — teda presne
                // tú kombináciu, ktorú CSRF vznikol riešiť.
                $this->assertNotContains(
                    StartSession::class,
                    $middleware,
                    "Routa {$route->uri()} je v programovom okruhu, ale nesie session."
                );

                return;
            }

            $ui++;

            $this->assertContains('auth.ui', $middleware, "Routa {$route->uri()} nie je za UI guardom.");
            $this->assertContains(ValidateCsrfToken::class, $middleware, "Routa {$route->uri()} nemá CSRF.");
        });

        // Oba okruhy musia byť neprázdne: keby jeden zmizol, tento test by
        // prešel a tvrdil, že je všetko v poriadku.
        $this->assertGreaterThan(0, $ui, 'UI okruh konzoly nemá ani jednu routu.');
        $this->assertGreaterThan(0, $programmatic, 'Programový okruh konzoly nemá ani jednu routu.');
    }

    /** Programová routa musí byť bez tokenu zamknutá rovnako ako UI okruh. */
    public function test_the_programmatic_circuit_is_locked_too(): void
    {
        $this->locked()->postJson('/api/console/headless', ['message' => 'ahoj'])->assertStatus(401);
        $this->locked()->postJson('/api/console/cli/run', [])->assertStatus(401);
    }

    /** Zápis bez CSRF tokenu neprejde ani s odomknutou session. */
    public function test_write_without_csrf_is_rejected(): void
    {
        $this->enforceCsrf();

        $this->locked()
            ->withSession([AuthenticateUi::SESSION_KEY => hash('sha256', self::UI_TOKEN)])
            ->post('/api/console/threads', [])
            ->assertStatus(419);

        $this->assertSame(0, ConsoleThread::count());
    }

    // ---- vlákna fungujú, keď je okruh odomknutý ----------------------------

    public function test_thread_lifecycle_when_unlocked(): void
    {
        $created = $this->postJson('/api/console/threads', ['model' => 'qwen3:8b'])
            ->assertStatus(201)
            ->json();

        $this->assertSame('qwen3:8b', $created['model']);
        $this->assertSame('ollama', $created['provider']);

        $this->getJson('/api/console/threads')
            ->assertOk()
            ->assertJsonPath('threads.0.uuid', $created['uuid']);

        $this->patchJson('/api/console/threads/'.$created['uuid'], ['auto_accept' => true])
            ->assertOk()
            ->assertJsonPath('auto_accept', true);

        $this->deleteJson('/api/console/threads/'.$created['uuid'])->assertOk();

        $this->assertSame(0, ConsoleThread::count());
    }

    public function test_thread_uuid_is_the_public_identifier(): void
    {
        $thread = ConsoleThread::create([]);

        // id v adrese by prezrádzalo počet vlákien; binding ide cez uuid
        $this->getJson('/api/console/threads/'.$thread->id)->assertStatus(404);
        $this->getJson('/api/console/threads/'.$thread->uuid)->assertOk();
    }
}
