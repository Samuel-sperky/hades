<?php

namespace Tests\Feature;

use App\Http\Controllers\Console\ReportController;
use App\Http\Middleware\AuthenticateUi;
use App\Models\ConsoleReport;
use App\Services\Console\ReportWriter;
use App\Services\Console\Tools\ToolRefusal;
use App\Services\Console\Tools\WriteReportTool;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\RefreshDatabaseState;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * HTML reporty konzoly.
 *
 * Ťažisko testu je SANITIZÁCIA, nie formátovanie. Report píše model a servuje ho
 * autentizovaná routa v tom istom origine ako appka — skript, ktorý by v ňom
 * prežil, by mal session cookie človeka a prístup na `/api/nodes`. Preto sa tu
 * netestuje „vyzerá to dobre", ale „nedá sa tým nič spustiť".
 */
class ConsoleReportTest extends TestCase
{
    use RefreshDatabase;

    /** Súbory, ktoré v priečinku reportov boli PRED testom — tie sa nemažú. */
    private array $preexisting = [];

    /**
     * Migrácie tohto worktree treba PRIHLÁSIŤ, inak `console_reports` nevznikne.
     *
     * `vendor` je vo worktree symlink na hlavný checkout a `Application::inferBasePath()`
     * sa počíta z jeho polohy, takže `base_path()` — a s ním predvolený priečinok
     * migrácií — ukazuje na HLAVNÚ vetvu. Tá moju migráciu nemá; bez tohto hooku
     * dostane každý test „Base table or view not found".
     *
     * Rovnaké názvy migrácií sa v `Migrator::getMigrationFiles()` zlúčia podľa
     * mena súboru, takže pridanie cesty nič nespustí dvakrát.
     */
    protected function beforeRefreshingDatabase(): void
    {
        $this->app['migrator']->path(dirname(__DIR__, 2).'/database/migrations');

        // Sadu môže začať iná trieda, ktorá zmigrovala bez tejto cesty — potom už
        // `migrate:fresh` nepobeží a tabuľka chýba. Dotvoríme ju TU, ešte pred
        // otvorením transakcie: CREATE TABLE v MySQL transakciu implicitne
        // commituje a v `afterRefreshingDatabase()` by tým rozbil izoláciu testu.
        if (RefreshDatabaseState::$migrated && ! Schema::hasTable('console_reports')) {
            (require dirname(__DIR__, 2).'/database/migrations/2026_08_19_010001_create_console_reports_table.php')->up();
        }
    }

    protected function setUp(): void
    {
        parent::setUp();

        config(['cache.default' => 'array']);

        $this->preexisting = $this->reportFiles();
        $this->registerReportRoute();
    }

    /**
     * Reporty vznikajú ako súbory a `RefreshDatabase` o disku nevie. Bez tohto
     * by každý beh sady nechal v `storage/app/reports` ďalšie sirotence.
     */
    protected function tearDown(): void
    {
        foreach (array_diff($this->reportFiles(), $this->preexisting) as $path) {
            @unlink($path);
        }

        parent::tearDown();
    }

    /** @return array<int, string> */
    private function reportFiles(): array
    {
        return glob(storage_path('app/reports/*.html')) ?: [];
    }

    /**
     * Routu vlastní integrátor (`routes/web.php`). Kým tam nie je, test si ju
     * postaví sám — okruh `auth.ui` sa musí dať overiť aj tak, a keď routa
     * pribudne, test bude merať tú skutočnú.
     */
    private function registerReportRoute(): void
    {
        $exists = collect(app('router')->getRoutes()->getRoutes())
            ->contains(fn ($route) => str_starts_with($route->uri(), 'console/reports'));

        if ($exists) {
            return;
        }

        Route::middleware(['web', 'auth.ui'])
            ->get('/console/reports/{report:uuid}', [ReportController::class, 'show']);
    }

    /** Zhodí default odomykaciu hlavičku z Tests\TestCase — request je „cudzí proces". */
    private function locked(): static
    {
        $this->flushHeaders();

        return $this;
    }

    private function writer(): ReportWriter
    {
        return app(ReportWriter::class);
    }

    // ---- zápis -------------------------------------------------------------

    public function test_markdown_report_lands_on_disk_and_in_db(): void
    {
        $report = $this->writer()->write(
            'Stav testov',
            "# Prehľad behu\n\nVšetko zelené.\n\n- prvá položka\n- druhá položka\n",
        );

        $this->assertFileExists($report->absolutePath());
        $this->assertDatabaseHas('console_reports', [
            'uuid' => $report->uuid,
            'title' => 'Stav testov',
            'format' => 'markdown',
        ]);
        $this->assertGreaterThan(0, $report->bytes);

        // entity aj surové UTF-8 sú v prehliadači to isté; test nesmie padnúť na tom, čo z toho DOM vypľuje
        $html = html_entity_decode((string) file_get_contents($report->absolutePath()), ENT_QUOTES, 'UTF-8');

        $this->assertStringContainsString('<!DOCTYPE html>', $html);
        $this->assertStringContainsString('<html lang="sk">', $html);
        $this->assertStringContainsString('<h1>Prehľad behu</h1>', $html);
        $this->assertStringContainsString('<li>prvá položka</li>', $html);
        // titulok je v hlavičke stránky, nie len v <title>
        $this->assertStringContainsString('<title>Stav testov</title>', $html);
    }

    public function test_dangerous_markup_does_not_survive(): void
    {
        $report = $this->writer()->write('Nebezpečný report', <<<'HTML'
            <p>Ahoj</p>
            <script>alert(1)</script>
            <img src="x.png" onerror="alert(2)">
            <a href="javascript:alert(3)">klik</a>
            <iframe src="https://example.com/"></iframe>
            <form action="/api/nodes" method="post"><button>odoslať</button></form>
            <a href="&#106;avascript:alert(4)">entita</a>
            HTML, 'html');

        $html = (string) file_get_contents($report->absolutePath());

        // obsah, ktorý sa má zachovať
        $this->assertStringContainsString('<p>Ahoj</p>', $html);

        // a všetko, čo vie spustiť kód, musí byť preč — vrátane atribútov
        $this->assertStringNotContainsString('<script', $html);
        $this->assertStringNotContainsString('onerror', $html);
        $this->assertStringNotContainsString('javascript:', $html);
        $this->assertStringNotContainsString('<iframe', $html);
        $this->assertStringNotContainsString('<form', $html);
        // najsilnejšie kritérium: ani jedno z tiel tých handlerov nikde nezostalo
        $this->assertStringNotContainsString('alert(', $html);
    }

    public function test_markdown_input_is_sanitized_too(): void
    {
        // CommonMark zaescapuje blokový `<script>`, ale `onclick` na inline HTML
        // prepustí nedotknutý — markdown teda NIE JE bezpečný vstup
        $report = $this->writer()->write('Markdown', "Text\n\n<div onclick=\"alert(7)\">klik</div>\n");

        $html = (string) file_get_contents($report->absolutePath());

        $this->assertStringContainsString('<div>klik</div>', $html);
        $this->assertStringNotContainsString('onclick', $html);
        $this->assertStringNotContainsString('alert(', $html);
    }

    public function test_page_carries_both_themes(): void
    {
        $report = $this->writer()->write('Témy', 'Text.');

        $html = (string) file_get_contents($report->absolutePath());

        $this->assertStringContainsString(':root {', $html);
        $this->assertStringContainsString('prefers-color-scheme: dark', $html);
    }

    public function test_content_over_the_cap_is_refused(): void
    {
        config(['hades.console.reports.cap' => 100]);

        try {
            $this->writer()->write('Priveľký', str_repeat('a', 101));
            $this->fail('Obsah nad stropom mal byť odmietnutý.');
        } catch (ToolRefusal $refusal) {
            // model musí z odmietnutia vedieť, aký strop platí, inak to skúsi znova rovnako
            $this->assertStringContainsString('100', $refusal->getMessage());
        }

        $this->assertSame(0, ConsoleReport::count());
    }

    public function test_unknown_format_is_refused(): void
    {
        $this->expectException(ToolRefusal::class);

        $this->writer()->write('PDF', 'Text.', 'pdf');
    }

    public function test_only_the_newest_reports_are_kept(): void
    {
        config(['hades.console.reports.keep' => 2]);

        $first = $this->writer()->write('Prvý', 'Text.');
        $second = $this->writer()->write('Druhý', 'Text.');
        $third = $this->writer()->write('Tretí', 'Text.');

        $this->assertSame(2, ConsoleReport::count());
        $this->assertDatabaseMissing('console_reports', ['uuid' => $first->uuid]);
        $this->assertDatabaseHas('console_reports', ['uuid' => $second->uuid]);
        $this->assertDatabaseHas('console_reports', ['uuid' => $third->uuid]);

        // riadok bez súboru je 404, ale súbor bez riadku je sirota, ktorú už nikto nezmaže
        $this->assertFileDoesNotExist($first->absolutePath());
        $this->assertFileExists($second->absolutePath());
        $this->assertFileExists($third->absolutePath());
    }

    // ---- tool --------------------------------------------------------------

    public function test_tool_is_a_write(): void
    {
        $this->assertTrue($this->tool()->isWrite());
    }

    public function test_tool_preview_shows_title_format_and_head_of_content(): void
    {
        $preview = $this->tool()->preview([
            'title' => 'Stav testov',
            'content' => str_repeat('x', 900),
        ]);

        $this->assertStringContainsString('Stav testov', (string) $preview);
        $this->assertStringContainsString('markdown', (string) $preview);
        $this->assertStringContainsString('900', (string) $preview);
    }

    public function test_tool_returns_the_url_of_the_report(): void
    {
        $result = $this->tool()->execute([
            'title' => 'Stav testov',
            'content' => "# Stav\n\nZelené.\n",
        ]);

        $report = ConsoleReport::sole();

        $this->assertSame($report->uuid, $result->data['uuid']);
        $this->assertSame('/console/reports/'.$report->uuid, $result->data['url']);
        $this->assertStringContainsString('/console/reports/'.$report->uuid, $result->text);
        $this->assertFalse($result->failed);
    }

    private function tool(): WriteReportTool
    {
        return new WriteReportTool($this->writer());
    }

    // ---- routa -------------------------------------------------------------

    public function test_report_url_is_locked(): void
    {
        $report = $this->writer()->write('Tajný', 'Text.');

        $this->locked()->get($report->url())->assertStatus(401);
    }

    public function test_report_is_served_with_csp_when_unlocked(): void
    {
        $report = $this->writer()->write('Verejný', "# Verejný\n\nText.\n");

        $response = $this->locked()
            ->withSession([AuthenticateUi::SESSION_KEY => hash('sha256', self::UI_TOKEN)])
            ->get($report->url())
            ->assertOk();

        $csp = (string) $response->headers->get('Content-Security-Policy');

        $this->assertStringContainsString("default-src 'none'", $csp);
        $this->assertStringContainsString("style-src 'unsafe-inline'", $csp);
        $this->assertStringContainsString("base-uri 'none'", $csp);
        $this->assertStringContainsString("form-action 'none'", $csp);
        $this->assertSame('nosniff', $response->headers->get('X-Content-Type-Options'));
        $this->assertStringContainsString('inline', (string) $response->headers->get('Content-Disposition'));
        $this->assertStringContainsString('text/html', (string) $response->headers->get('Content-Type'));
    }

    public function test_download_query_sends_the_report_as_a_file(): void
    {
        $report = $this->writer()->write('Stav testov', 'Text.');

        $disposition = (string) $this->locked()
            ->withSession([AuthenticateUi::SESSION_KEY => hash('sha256', self::UI_TOKEN)])
            ->get($report->url().'?download=1')
            ->assertOk()
            ->headers->get('Content-Disposition');

        $this->assertStringContainsString('attachment', $disposition);
        $this->assertStringContainsString('stav-testov.html', $disposition);
    }

    public function test_missing_file_is_404_not_500(): void
    {
        $report = $this->writer()->write('Zmazaný', 'Text.');

        unlink($report->absolutePath());

        $this->locked()
            ->withSession([AuthenticateUi::SESSION_KEY => hash('sha256', self::UI_TOKEN)])
            ->get($report->url())
            ->assertStatus(404);
    }
}
