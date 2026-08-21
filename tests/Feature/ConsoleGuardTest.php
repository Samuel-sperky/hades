<?php

namespace Tests\Feature;

use App\Http\Middleware\AuthenticateUi;
use App\Models\ConsoleThread;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Charón (`/console`) je najsilnejší vstup do appky: jej tooly vedia
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
        $this->get('/console')->assertOk()->assertSee('Charón');
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
     * Každá routa pod `/api/console/` musí nesť guard aj CSRF.
     *
     * Toto je ten test, ktorý zachytí budúci pridaný endpoint — nezoznamuje
     * ručne, ale prejde router a overí, čo na routách reálne visí.
     */
    public function test_every_console_route_carries_guard_and_csrf(): void
    {
        $routes = collect(app('router')->getRoutes()->getRoutes())
            ->filter(fn ($route) => str_starts_with($route->uri(), 'api/console'));

        $this->assertGreaterThan(0, $routes->count(), 'Konzola nemá žiadne API routy — test by inak prešiel naprázdno.');

        $routes->each(function ($route) {
            $middleware = $route->gatherMiddleware();

            $this->assertContains('auth.ui', $middleware, "Routa {$route->uri()} nie je za UI guardom.");
            $this->assertContains(ValidateCsrfToken::class, $middleware, "Routa {$route->uri()} nemá CSRF.");
        });
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
