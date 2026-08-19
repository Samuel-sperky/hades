<?php

namespace Tests\Feature;

use App\Services\Console\CommandCage;
use App\Services\Console\Tools\BashTool;
use App\Services\Console\Tools\ToolRefusal;
use Tests\TestCase;

/**
 * Klietka shellu ({@see CommandCage}) a tool `bash`.
 *
 * Toto je súbor pre bezpečnostnú prehliadku, takže je usporiadaný podľa toho, čo
 * sa môže pokaziť, nie podľa toho, ako sú napísané metódy:
 *
 *  1. čo klietka pustí (aby otrava zostala v znesiteľných hraniciach),
 *  2. `deny` — čo sa nedá povoliť ani omylom, ani „navždy",
 *  3. gramatika — reťazenie, substitúcia a presmerovanie, teda tri spôsoby, ako
 *     z povoleného `ls` urobiť `rm -rf`,
 *  4. rúra — jediná povolená spojka, a preto sa každý jej segment validuje sám,
 *  5. `pattern()` — kľúč pre „povoliť navždy"; keby bol príliš hrubý, jeden klik
 *     by povolil viac, než človek videl,
 *  6. beh naozaj: exit kód, vypršanie, strop na výstup,
 *  7. vypnutý shell.
 *
 * Testy 1–5 sú čisté a rýchle, 6 spúšťa skutočné procesy v kontejneri.
 */
class ConsoleBashToolTest extends TestCase
{
    /**
     * Klietka sa MUSÍ merať proti configu TOHTO repozitára.
     *
     * Vo worktree je `vendor` symlink na hlavný checkout a
     * `Illuminate\Foundation\Testing\TestCase::createApplication()` si
     * `bootstrap/app.php` hľadá relatívne k nemu — appka sa teda nabootuje
     * s configom CUDZEJ vetvy. Keby tam `console.bash` chýbal, biely zoznam by
     * bol prázdny a *všetky* testy odmietnutia by prešli zo zlého dôvodu
     * (prázdny zoznam odmieta aj `php artisan test`), pričom povolenia by padli.
     * Presne to sa stalo pri prvom behu.
     *
     * V hlavnom checkoute je `dirname(__DIR__, 2)` to isté ako `base_path()`,
     * takže tu nič nepretáča — len to prestane závisieť od toho, odkiaľ sa appka
     * nabootovala.
     */
    protected function setUp(): void
    {
        parent::setUp();

        $hades = require dirname(__DIR__, 2).'/config/hades.php';

        config(['hades.console.bash' => $hades['console']['bash']]);
    }

    private function cage(): CommandCage
    {
        return app(CommandCage::class);
    }

    private function tool(): BashTool
    {
        return app(BashTool::class);
    }

    // ---- 1. čo klietka pustí -------------------------------------------------

    /**
     * Príkazy, pre ktoré tool vznikol. Keby ich biely zoznam nepustil, model by
     * nemal ako overiť vlastnú zmenu — a to je presne stav, ktorý shell riešil.
     */
    public function test_the_commands_the_tool_exists_for_are_allowed(): void
    {
        foreach ([
            'php artisan test --filter Foo',
            'git status',
            'rg needle app',
            'ls -la app',
        ] as $command) {
            $this->assertNull(
                $this->cage()->refusalFor($command),
                "„{$command}\" musí klietka pustiť"
            );
        }
    }

    // ---- 2. deny -------------------------------------------------------------

    /**
     * `deny` má prednosť pred `allow` a nedá sa prepísať ani povolením navždy.
     *
     * Kontroluje sa, že refusal je NAOZAJ z `deny` zoznamu, nie z bieleho:
     * prázdny biely zoznam odmieta všetko, takže „je to odmietnuté" by tu prešlo
     * aj vtedy, keby sa config vôbec nenačítal — na to sa dá naletieť a naletel
     * som na to (viď `setUp()`).
     */
    public function test_destructive_commands_are_refused(): void
    {
        foreach ([
            'rm -rf app',
            'git push origin main',
            'php artisan tinker',
            'cat .env',
            'sudo ls',
            'sh -c ls',
            'find . -delete',
            'docker ps',
        ] as $command) {
            $refusal = (string) $this->cage()->refusalFor($command);

            $this->assertStringContainsString(
                'deny list',
                $refusal,
                "„{$command}\" musí padnúť na deny zoznam, nie na biely zoznam"
            );
        }
    }

    /**
     * `find . -exec rm {} ;` je na `deny` zozname, ale zastaví ho už gramatika —
     * obsahuje `;`. Dôležité nie je, KTORÉ pravidlo ho zachytí, ale že sa
     * nespustí ani jednou cestou.
     */
    public function test_find_exec_is_refused_by_the_grammar_before_the_deny_list(): void
    {
        $this->assertNotNull($this->cage()->refusalFor('find . -exec rm {} ;'));
    }

    /** `execute()` odmietnutie prekladá na {@see ToolRefusal}, nie na tichý beh. */
    public function test_execute_throws_on_a_denied_command(): void
    {
        $this->expectException(ToolRefusal::class);

        $this->tool()->execute(['command' => 'rm -rf app']);
    }

    // ---- 3. gramatika --------------------------------------------------------

    /**
     * Reťazenie, substitúcia a presmerovanie sú tri spôsoby, ako z povoleného
     * príkazu urobiť ľubovoľný: `ls; rm -rf x` je proti zoznamu „ls".
     */
    public function test_chaining_substitution_and_redirection_are_refused(): void
    {
        foreach ([
            'ls; rm -rf x',
            'ls && rm -rf x',
            'ls || rm -rf x',
            'ls & rm -rf x',
            'cat app/x.php > out.txt',
            'cat app/x.php >> out.txt',
            'wc -l < app/x.php',
            'cat $(ls)',
            'cat ${HOME}/x',
            'cat `ls`',
            "ls\nrm -rf x",
        ] as $command) {
            $this->assertNotNull(
                $this->cage()->refusalFor($command),
                'štruktúra „'.addcslashes($command, "\n").'" musí byť odmietnutá'
            );
        }
    }

    /** Prázdny a neúnosne dlhý príkaz — človek by druhý v dialógu nikdy neprečítal. */
    public function test_empty_and_overlong_commands_are_refused(): void
    {
        $this->assertNotNull($this->cage()->refusalFor('   '));
        $this->assertNotNull($this->cage()->refusalFor('ls '.str_repeat('a', 2000)));
    }

    // ---- 4. rúra -------------------------------------------------------------

    /** Rúra je jediná povolená spojka — a je povolená naozaj, nie len na papieri. */
    public function test_a_pipe_of_allowed_segments_passes(): void
    {
        $this->assertNull($this->cage()->refusalFor('rg needle app | head -5'));
    }

    /**
     * Druhý segment rúry sa validuje tak isto ako prvý. Keby sa validoval len
     * prvý, `|` by bola tá istá diera ako `;`.
     */
    public function test_a_pipe_into_a_forbidden_command_is_refused(): void
    {
        $this->assertNotNull($this->cage()->refusalFor('ls | rm -rf x'));
    }

    /**
     * Nesediaci segment sa v odmietnutí CITUJE. Bez toho model nevie, ktorá
     * polovica rúry padla, a skúša tú istú vetu s inou drobnosťou dokola — čo je
     * na CPU inferencii minúta za pokus.
     */
    public function test_the_offending_segment_is_quoted_in_the_refusal(): void
    {
        $refusal = (string) $this->cage()->refusalFor('rg needle app | banana --peel');

        $this->assertStringContainsString('banana --peel', $refusal);
        $this->assertStringContainsString('ALLOWLIST', $refusal);
    }

    // ---- 5. pattern ----------------------------------------------------------

    /**
     * Kľúč pre „povoliť navždy". Musí byť hrubší než príkaz (aby človek
     * nepotvrdzoval každý `--filter`), ale nie taký hrubý, aby `git status`
     * povolilo aj `git push`.
     */
    public function test_pattern_normalises_the_command_to_a_permission_key(): void
    {
        $cage = $this->cage();

        $this->assertSame('php artisan test', $cage->pattern('php artisan test --filter Foo'));
        $this->assertSame('git status', $cage->pattern('git status --short'));
        $this->assertSame('php vendor/bin/phpunit', $cage->pattern('php vendor/bin/phpunit -c tests/phpunit.klient.xml'));
        $this->assertSame('rg', $cage->pattern('rg needle app | head -5'));
    }

    // ---- 6. beh --------------------------------------------------------------

    /** Shell je zápis VŽDY, aj keď príkaz len číta — viď komentár v BashTool. */
    public function test_bash_is_always_a_write(): void
    {
        $this->assertTrue($this->tool()->isWrite());
    }

    /** Náhľad ukáže dôvod odmietnutia namiesto toho, aby spadol. */
    public function test_preview_shows_the_cage_verdict_instead_of_throwing(): void
    {
        $preview = (string) $this->tool()->preview(['command' => 'rm -rf app']);

        $this->assertStringContainsString('rm -rf app', $preview);
        $this->assertStringContainsString('odmieta', $preview);
    }

    public function test_a_real_command_runs_and_reports_its_exit_code(): void
    {
        $result = $this->cage()->run('php --version');

        $this->assertSame(0, $result['exit_code']);
        $this->assertFalse($result['timed_out']);
        $this->assertStringContainsString('PHP', $result['output']);

        $text = $this->tool()->execute(['command' => 'php --version'])->text;

        // Exit kód na prvom riadku: výstup sa kráti od konca, takže na konci by ho
        // model pri dlhom výpise nikdy neuvidel.
        $this->assertStringStartsWith('exit 0', $text);
        $this->assertStringContainsString('PHP', $text);
    }

    /**
     * Vypršanie nie je prázdny výsledok — `php artisan test` pred zabitím vypíše,
     * ktorý test visel, a to je celá odpoveď na otázku „prečo".
     */
    public function test_a_command_that_runs_too_long_times_out(): void
    {
        config([
            'hades.console.bash.timeout' => 1,
            'hades.console.bash.allow' => ['/^sleep \d+$/'],
        ]);

        $this->assertNull($this->cage()->refusalFor('sleep 5'));

        $result = $this->cage()->run('sleep 5');

        $this->assertTrue($result['timed_out']);
        $this->assertLessThan(5000, $result['duration_ms']);

        $text = $this->tool()->execute(['command' => 'sleep 5'])->text;

        $this->assertStringContainsString('timed out after 1 seconds', $text);
    }

    /**
     * Skrátenie sa MUSÍ priznať: model, ktorý nevie, že mu chýba koniec výpisu
     * testov, si domyslí, že prešli.
     */
    public function test_long_output_is_capped_and_the_cut_is_admitted(): void
    {
        config(['hades.console.bash.output_cap' => 20]);

        $result = $this->tool()->execute(['command' => 'php --version']);

        $this->assertTrue($result->truncated);
        $this->assertStringContainsString('truncated', $result->text);
    }

    // ---- 7. vypnutý shell ----------------------------------------------------

    /** Vypnutý shell to musí povedať, inak model hádže príkazy do prázdna. */
    public function test_a_disabled_shell_says_so(): void
    {
        config(['hades.console.bash.enabled' => false]);

        $refusal = (string) $this->cage()->refusalFor('php artisan test');

        $this->assertStringContainsString('disabled', $refusal);
    }

    // ---- 8. čo našla sonda 19. 8. 2026 ---------------------------------------

    /**
     * Rúra V ARGUMENTE nie je spojka.
     *
     * `rg -e "foo|bar" app` sa pri naivnom `explode('|')` rozpadlo na `rg -e "foo`
     * a `bar" app`, druhý segment neprešel bielym zoznamom a klietka odmietla úplne
     * legitímne hľadanie. Bola to funkčná chyba, nie bezpečnostná — a taká, ktorú
     * model „opravuje" ďalšími pokusmi po minúte na CPU.
     */
    public function test_a_pipe_inside_quotes_is_an_argument_not_a_connector(): void
    {
        $this->assertNull($this->cage()->refusalFor('rg -e "foo|bar" app'));
        $this->assertNull($this->cage()->refusalFor("rg 'a|b' app"));

        // A skutočná rúra vedľa toho funguje ďalej.
        $this->assertNull($this->cage()->refusalFor('rg -e "foo|bar" app | head -5'));
    }

    /** Nezavretá úvodzovka by nechala shell čakať do timeoutu. */
    public function test_an_unbalanced_quote_is_refused(): void
    {
        $refusal = (string) $this->cage()->refusalFor('rg "foo app');

        $this->assertStringContainsString('quote', $refusal);
    }

    /** Dve medzery sú ten istý príkaz — model diktuje po tokenoch, nie po znakoch. */
    public function test_extra_whitespace_does_not_change_the_command(): void
    {
        $this->assertNull($this->cage()->refusalFor('php  artisan  test'));
        $this->assertSame('php artisan test', $this->cage()->pattern('php  artisan  test'));
    }

    /**
     * `curl` smie hovoriť s APPKOU, nie s čímkoľvek na localhoste.
     *
     * Sonda ukázala, že `curl http://127.0.0.1:6379/` prešel — to je Redis tejto
     * appky, teda cache a sessions. Port je preto zoznam a za URL nesmie nasledovať
     * nič, aby sa nedal pripojiť `-o`, ktorým curl zapisuje súbory.
     */
    public function test_curl_reaches_the_application_and_nothing_else(): void
    {
        $this->assertNull($this->cage()->refusalFor('curl -s http://localhost:8080/up'));

        $this->assertNotNull($this->cage()->refusalFor('curl -s http://127.0.0.1:6379/'));
        $this->assertNotNull($this->cage()->refusalFor('curl -s http://127.0.0.1:3306/'));
        $this->assertNotNull($this->cage()->refusalFor('curl -s http://example.com/'));
        $this->assertNotNull($this->cage()->refusalFor('curl -s -o /tmp/x http://localhost:8080/'));
    }

    /**
     * `sed` v bielom zozname nemá čo robiť: `sed -n '1w /tmp/x'` ZAPÍŠE súbor.
     * Čítanie riadkov pokrýva head/tail/cut a tool `read_file`.
     */
    public function test_sed_is_not_on_the_allowlist_because_it_writes_files(): void
    {
        $this->assertNotNull($this->cage()->refusalFor('sed -n "1w /tmp/out" app/Models/Node.php'));
        $this->assertNotNull($this->cage()->refusalFor('sed -n 1,20p app/Models/Node.php'));
    }

    /** `npm run build` nesmie povoliť `npm run watch` — skripty žijú v package.json. */
    public function test_npm_run_narrows_to_the_script_name(): void
    {
        $this->assertSame('npm run build', $this->cage()->pattern('npm run build'));
        $this->assertSame('npm run watch', $this->cage()->pattern('npm run watch'));
    }
}
