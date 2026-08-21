<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Node;
use App\Models\Tombstone;
use App\Services\Console\ToolRegistry;
use App\Services\Console\Tools\ConsoleTool;
use App\Services\Console\Tools\PathGuard;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Tests\TestCase;

/**
 * Toolová vrstva Charóna.
 *
 * Toto je súbor, ktorý si prečíta bezpečnostná prehliadka, takže je usporiadaný
 * podľa toho, čo sa môže pokaziť, nie podľa toho, ako sú napísané triedy:
 *
 *  1. čítacie a zápisové tooly na správnej strane (`isWrite`),
 *  2. cesta mimo koreňa, symlink von, `.env` a `.git` z vnútra koreňa,
 *  3. shell metaznaky vo vzore grepu ako obyčajný text,
 *  4. stropy a priznané skrátenie,
 *  5. zápisy: nejednoznačný `old_string`, prázdna zmena, odpad do pamäte,
 *  6. mazanie je vratné (soft delete + náhrobok),
 *  7. tvar definícií pre jazykovú vrstvu (`LlmProvider`).
 *
 * `files_root` sa v každom teste prepne do dočasného priečinka. Nie preto, že by
 * to bolo pohodlnejšie — ale preto, že zápisové tooly v teste inak píšu do
 * skutočného repozitára a jeden zle napísaný test prepíše zdrojový súbor.
 */
class ConsoleToolsTest extends TestCase
{
    use RefreshDatabase;

    private string $root;

    protected function setUp(): void
    {
        parent::setUp();

        // Skutočná (rozložená) cesta: `sys_get_temp_dir()` býva symlink a PathGuard
        // porovnáva rozložené cesty — bez realpath by tu zlyhalo všetko naraz.
        $base = realpath(sys_get_temp_dir()).'/hades-console-'.bin2hex(random_bytes(4));
        File::makeDirectory($base.'/app/Services', 0777, true);
        $this->root = (string) realpath($base);

        config([
            'cache.default' => 'array',
            'hades.console.files_root' => $this->root,
            'hades.console.read_cap' => 60000,
            'hades.console.grep_cap' => 20000,
            // Vektorová vetva recallu sa v testoch nesmie pýtať Ollamy —
            // inak test závisí od toho, či na stroji beží model.
            'hades.embeddings.enabled' => false,
        ]);

        Area::create(['name' => 'Vývoj / kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0]);
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->root);

        parent::tearDown();
    }

    private function registry(): ToolRegistry
    {
        return app(ToolRegistry::class);
    }

    private function tool(string $name): ConsoleTool
    {
        return $this->registry()->get($name);
    }

    /** Recall potrebuje MariaDB — `searchNodes` stojí na `COLLATE`, ktoré sqlite nepozná. */
    private function skipWithoutMariadb(): void
    {
        if (DB::connection()->getDriverName() === 'sqlite') {
            $this->markTestSkipped('recall/searchNodes vyžaduje MariaDB COLLATE.');
        }
    }

    private function putFile(string $relative, string $content): string
    {
        $path = $this->root.'/'.$relative;
        File::ensureDirectoryExists(dirname($path));
        File::put($path, $content);

        return $path;
    }

    // ---- 1. čítacie vs. zápisové ---------------------------------------------

    /**
     * Nový tool zaradený na nesprávnu stranu nie je preklep, ale diera: zápisový
     * tool s `isWrite() === false` sa vykoná bez toho, aby ho človek videl.
     * Zoznamy sú preto vypísané menovite — pridanie toolu musí prejsť týmto testom.
     */
    public function test_read_tools_run_without_asking_and_write_tools_do_not(): void
    {
        $registry = $this->registry();

        foreach (['mind_recall', 'mind_read', 'mind_overview', 'read_file', 'glob', 'grep'] as $name) {
            $this->assertFalse($registry->isWrite($name), "{$name} musí byť čítací");
        }

        foreach ([
            'mind_learn', 'mind_rename', 'mind_move', 'mind_delete', 'edit_file', 'write_file',
        ] as $name) {
            $this->assertTrue($registry->isWrite($name), "{$name} musí vyžadovať potvrdenie");
        }

        // A žiadny tool nesmie v registri pribudnúť bez toho, aby o ňom tento
        // test vedel — inak by nová diera prešla „lebo testy sú zelené".
        $this->assertSame([
            'mind_recall', 'mind_read', 'mind_overview', 'grep', 'glob', 'read_file',
            'mind_learn', 'mind_rename', 'mind_move', 'mind_delete', 'edit_file', 'write_file',
        ], $registry->names());
    }

    /** Neznámy tool je zápisový — fail-closed, inak by preklep v mene obišel potvrdenie. */
    public function test_unknown_tool_is_treated_as_write(): void
    {
        $this->assertTrue($this->registry()->isWrite('rm_minus_rf'));
        $this->assertTrue($this->registry()->call('rm_minus_rf', [])->failed);
    }

    /** Každý zápisový tool musí vedieť ukázať náhľad — inak človek potvrdzuje naslepo. */
    public function test_every_write_tool_returns_a_preview(): void
    {
        $this->putFile('app/Services/Demo.php', "<?php\n\nreturn 1;\n");

        $previews = [
            'edit_file' => ['path' => 'app/Services/Demo.php', 'old_string' => 'return 1;', 'new_string' => 'return 2;'],
            'write_file' => ['path' => 'app/Services/New.php', 'content' => "<?php\n"],
            'mind_learn' => [
                'type' => 'skill', 'label' => 'Konzola vedomia', 'area' => 'Vývoj / kód',
                'description' => 'Agentová smyčka nad vlastnými toolmi v Hadese.',
            ],
        ];

        foreach ($previews as $name => $args) {
            $preview = $this->registry()->preview($name, $args);
            $this->assertNotEmpty($preview, "{$name} musí vrátiť náhľad");
        }
    }

    // ---- 2. cesty ------------------------------------------------------------

    public function test_path_traversal_out_of_the_root_is_refused(): void
    {
        // `../.env` — najbežnejší pokus a zároveň ten, ktorý by pri sanitizácii
        // (namiesto odmietnutia) ticho prečítal niečo iné.
        $result = $this->registry()->call('read_file', ['path' => '../.env']);

        $this->assertTrue($result->failed);
        $this->assertStringContainsString('Refused', $result->text);
    }

    public function test_absolute_path_outside_the_root_is_refused(): void
    {
        foreach (['/etc/passwd', '/etc', $this->root.'/../secrets.txt'] as $path) {
            $result = $this->registry()->call('read_file', ['path' => $path]);

            $this->assertTrue($result->failed, "{$path} musí byť odmietnutá");
        }
    }

    /**
     * Symlink je jediná cesta von, ktorú nie je vidieť v texte cesty — preto sa
     * kontroluje CIEĽ (`realpath`), nie zápis.
     */
    public function test_symlink_pointing_out_of_the_root_is_refused(): void
    {
        $outside = realpath(sys_get_temp_dir()).'/hades-outside-'.bin2hex(random_bytes(4)).'.txt';
        File::put($outside, "SECRET=1\n");

        if (! @symlink($outside, $this->root.'/escape.txt')) {
            File::delete($outside);
            $this->markTestSkipped('Prostredie nedovolí vytvoriť symlink.');
        }

        $read = $this->registry()->call('read_file', ['path' => 'escape.txt']);
        $write = $this->registry()->call('write_file', ['path' => 'escape.txt', 'content' => 'x']);

        File::delete($outside);

        $this->assertTrue($read->failed, 'čítanie cez symlink von musí byť odmietnuté');
        $this->assertTrue($write->failed, 'zápis cez symlink von musí byť odmietnutý');
        $this->assertStringNotContainsString('SECRET', $read->text);
    }

    /**
     * `.env` a `.git` sú zakázané aj VNÚTRI koreňa. Konzola je za guardom preto,
     * aby sa k tajomstvám nedalo dostať — nesmie byť sama cestou, ako ich vyniesť.
     */
    public function test_dotfiles_inside_the_root_are_refused_for_read_and_write(): void
    {
        $this->putFile('.env', "HADES_UI_TOKEN=tajne\n");
        $this->putFile('.git/config', "[core]\n");

        foreach (['.env', './.env', 'app/../.env', '.git/config', '.git'] as $path) {
            $read = $this->registry()->call('read_file', ['path' => $path]);
            $this->assertTrue($read->failed, "čítanie {$path} musí byť odmietnuté");
            $this->assertStringNotContainsString('tajne', $read->text);

            $write = $this->registry()->call('write_file', ['path' => $path, 'content' => 'x']);
            $this->assertTrue($write->failed, "zápis do {$path} musí byť odmietnutý");
        }

        // A obsah zostal nedotknutý.
        $this->assertSame("HADES_UI_TOKEN=tajne\n", File::get($this->root.'/.env'));
    }

    public function test_vendor_and_framework_internals_are_refused(): void
    {
        $this->putFile('vendor/laravel/framework/src/x.php', "<?php\n");
        $this->putFile('node_modules/pkg/index.js', "1\n");
        $this->putFile('storage/framework/sessions/abc', "session\n");

        foreach ([
            'vendor/laravel/framework/src/x.php',
            'node_modules/pkg/index.js',
            'storage/framework/sessions/abc',
        ] as $path) {
            $this->assertTrue(
                $this->registry()->call('read_file', ['path' => $path])->failed,
                "{$path} musí byť odmietnutá"
            );
        }
    }

    /** Zápis do neexistujúceho priečinka: kontroluje sa RODIČ, nie neexistujúci súbor. */
    public function test_write_into_a_missing_directory_is_refused_but_a_new_file_is_allowed(): void
    {
        $missing = $this->registry()->call('write_file', [
            'path' => 'aap/Services/Typo.php', 'content' => "<?php\n",
        ]);
        $this->assertTrue($missing->failed);
        $this->assertStringContainsString('Directory does not exist', $missing->text);

        $created = $this->registry()->call('write_file', [
            'path' => 'app/Services/Fresh.php', 'content' => "<?php\n\nreturn true;\n",
        ]);
        $this->assertFalse($created->failed);
        $this->assertFileExists($this->root.'/app/Services/Fresh.php');
    }

    public function test_guard_reports_paths_relative_to_the_root(): void
    {
        $guard = app(PathGuard::class);

        $this->assertSame('app/Services', $guard->relative($this->root.'/app/Services'));
        $this->assertSame('.', $guard->relative($this->root));
    }

    // ---- 3. grep: metaznaky sú text, nie príkaz ------------------------------

    /**
     * Vzor ide do `rg` ako jeden argv prvok, takže shell ho nikdy nevidí.
     *
     * Dokazuje sa to KANÁRIKOM, nie tvarom výstupu: vzor obsahuje príkaz, ktorý
     * by po vykonaní vyrobil súbor. Keď súbor nevznikol, žiadny shell nebežal —
     * a to je jediné tvrdenie, ktoré tu chceme mať. Ostatné metaznaky sa navyše
     * skutočne použijú ako text vzoru (`semi; colon` nájde svoj riadok).
     */
    public function test_grep_treats_shell_metacharacters_as_a_literal_pattern(): void
    {
        $canary = $this->root.'/PWNED';
        $this->putFile('app/danger.txt', "line one\n\$(whoami) is text here\n`id` also text\nsemi; colon\n");

        foreach ([
            '$(touch '.$canary.')',
            '`touch '.$canary.'`',
            '; touch '.$canary,
            '$(whoami)',
        ] as $pattern) {
            $result = $this->registry()->call('grep', ['pattern' => $pattern, 'path' => 'app']);

            // Žiadna zhoda je legitímna odpoveď (`$(…)` je ako regex platný, len
            // nič netrafí) — zlyhanie toolu by ale znamenalo, že sa vzor niekde
            // interpretoval, a to je presne to, čo tu nesmie nastať.
            $this->assertFalse($result->failed, "vzor {$pattern} nemá zlyhať");
            $this->assertFileDoesNotExist($canary, "vzor {$pattern} sa VYKONAL");
            $this->assertStringNotContainsString('uid=', $result->text);
        }

        // A metaznaky sa naozaj hľadajú ako text.
        $literal = $this->registry()->call('grep', ['pattern' => 'semi; colon', 'path' => 'app']);
        $this->assertStringContainsString('app/danger.txt', $literal->text);
        $this->assertStringContainsString('semi; colon', $literal->text);

        $escaped = $this->registry()->call('grep', ['pattern' => '\\$\\(whoami\\)', 'path' => 'app']);
        $this->assertStringContainsString('$(whoami) is text here', $escaped->text);
    }

    /** Vzor začínajúci pomlčkou nesmie byť prečítaný ako prepínač `rg`. */
    public function test_grep_pattern_starting_with_a_dash_is_not_an_option(): void
    {
        $this->putFile('app/dash.txt', "no match here\n--files is a literal here\n");

        $result = $this->registry()->call('grep', ['pattern' => '--files']);

        $this->assertFalse($result->failed);
        $this->assertStringContainsString('app/dash.txt', $result->text);
    }

    /**
     * Bez `path` sa musí prehľadať celý projekt — a cesty musia byť čisté.
     *
     * Toto je poistka na dve pasce naraz. `rg` bez cesty NEČÍTA `cwd`, ale STDIN,
     * ktorý Symfony Process zavrie: hľadanie by ticho nenašlo nič a vyzeralo by
     * to ako „žiadna zhoda", nie ako porucha. A `rg … -- .` zase predsadí každej
     * ceste `./`, ktoré model potom kopíruje do `read_file`.
     */
    public function test_grep_without_a_path_searches_the_whole_root_with_clean_paths(): void
    {
        $this->putFile('app/deep/nested/needle.txt', "ihla v kope sena\n");

        $result = $this->registry()->call('grep', ['pattern' => 'ihla v kope']);

        $this->assertFalse($result->failed);
        $this->assertStringContainsString('app/deep/nested/needle.txt:1:', $result->text);
        $this->assertStringNotContainsString('./app', $result->text);
        $this->assertStringNotContainsString($this->root, $result->text);
    }

    public function test_grep_never_searches_dotfiles_or_vendor(): void
    {
        $this->putFile('.env', "HADES_UI_TOKEN=tajne-heslo\n");
        $this->putFile('vendor/pkg/leak.php', "tajne-heslo\n");
        $this->putFile('app/clean.php', "nothing here\n");

        $result = $this->registry()->call('grep', ['pattern' => 'tajne-heslo']);

        $this->assertStringNotContainsString('tajne-heslo', $result->text);
        $this->assertStringNotContainsString('.env', $result->text);
    }

    public function test_grep_scope_outside_the_root_is_refused(): void
    {
        $result = $this->registry()->call('grep', ['pattern' => 'root', 'path' => '/etc']);

        $this->assertTrue($result->failed);
    }

    public function test_glob_lists_matching_files_and_hides_denied_ones(): void
    {
        $this->putFile('app/Services/One.php', "<?php\n");
        $this->putFile('app/Services/Two.php', "<?php\n");
        $this->putFile('vendor/pkg/Three.php', "<?php\n");
        $this->putFile('.hidden/Four.php', "<?php\n");

        $result = $this->registry()->call('glob', ['pattern' => '**/*.php']);

        $this->assertStringContainsString('app/Services/One.php', $result->text);
        $this->assertStringContainsString('app/Services/Two.php', $result->text);
        $this->assertStringNotContainsString('vendor/', $result->text);
        $this->assertStringNotContainsString('.hidden', $result->text);
        // Cesty sú relatívne a bez `./` — model ich kopíruje priamo do read_file.
        $this->assertStringNotContainsString('./app', $result->text);
        $this->assertStringNotContainsString($this->root, $result->text);
    }

    // ---- 4. stropy -----------------------------------------------------------

    /**
     * Skrátenie sa musí PRIZNAŤ. Model, ktorý nevie, že mu chýba koniec súboru,
     * si ho domyslí — a domyslený kód je horší než chýbajúci.
     */
    public function test_read_file_truncates_at_read_cap_and_says_so(): void
    {
        config(['hades.console.read_cap' => 500]);
        $this->putFile('app/big.txt', str_repeat("riadok s textom\n", 200));

        $result = $this->registry()->call('read_file', ['path' => 'app/big.txt']);

        $this->assertTrue($result->truncated);
        $this->assertStringContainsString('truncated', $result->text);
        $this->assertStringContainsString('500 of', $result->text);
        // Strop + hlavička + značka: text nesmie byť rádovo väčší než strop.
        $this->assertLessThan(900, mb_strlen($result->text));
    }

    public function test_read_file_numbers_lines_and_can_read_a_range(): void
    {
        $this->putFile('app/lines.txt', "alfa\nbeta\ngama\ndelta\n");

        $all = $this->registry()->call('read_file', ['path' => 'app/lines.txt']);
        $this->assertStringContainsString('1  alfa', $all->text);
        $this->assertStringContainsString('4  delta', $all->text);

        $range = $this->registry()->call('read_file', [
            'path' => 'app/lines.txt', 'start_line' => 2, 'end_line' => 3,
        ]);
        $this->assertStringContainsString('2  beta', $range->text);
        $this->assertStringNotContainsString('delta', $range->text);
    }

    public function test_read_file_refuses_a_directory_and_a_missing_file(): void
    {
        $this->assertTrue($this->registry()->call('read_file', ['path' => 'app'])->failed);
        $this->assertTrue($this->registry()->call('read_file', ['path' => 'app/nope.php'])->failed);
    }

    // ---- 5. zápis do súborov -------------------------------------------------

    public function test_edit_file_refuses_a_non_unique_old_string(): void
    {
        $path = $this->putFile('app/dup.php', "<?php\n\n\$x = 1;\n\$x = 1;\n");
        $before = File::get($path);

        $result = $this->registry()->call('edit_file', [
            'path' => 'app/dup.php', 'old_string' => '$x = 1;', 'new_string' => '$x = 2;',
        ]);

        $this->assertTrue($result->failed);
        $this->assertStringContainsString('appears 2 times', $result->text);
        $this->assertSame($before, File::get($path), 'súbor sa nesmel zmeniť');
    }

    public function test_edit_file_refuses_when_nothing_would_change(): void
    {
        $this->putFile('app/same.php', "<?php\n\nreturn 1;\n");

        $identical = $this->registry()->call('edit_file', [
            'path' => 'app/same.php', 'old_string' => 'return 1;', 'new_string' => 'return 1;',
        ]);
        $this->assertTrue($identical->failed);
        $this->assertStringContainsString('identical', $identical->text);

        $missing = $this->registry()->call('edit_file', [
            'path' => 'app/same.php', 'old_string' => 'return 42;', 'new_string' => 'return 1;',
        ]);
        $this->assertTrue($missing->failed);
        $this->assertStringContainsString('not in', $missing->text);
    }

    public function test_edit_file_replaces_a_unique_string(): void
    {
        $path = $this->putFile('app/edit.php', "<?php\n\n// prvý\nreturn 1;\n");

        $result = $this->registry()->call('edit_file', [
            'path' => 'app/edit.php', 'old_string' => 'return 1;', 'new_string' => 'return 2;',
        ]);

        $this->assertFalse($result->failed);
        $this->assertSame("<?php\n\n// prvý\nreturn 2;\n", File::get($path));
        $this->assertIsInt($result->durationMs);
    }

    /** Náhľad musí obsahovať OBE strany zmeny — inak človek nevidí, čo zmizne. */
    public function test_edit_file_preview_is_a_diff_with_both_sides(): void
    {
        $this->putFile('app/diff.php', "<?php\n\n\$a = 1;\n\$b = 2;\n\$c = 3;\n");

        $preview = (string) $this->registry()->preview('edit_file', [
            'path' => 'app/diff.php', 'old_string' => '$b = 2;', 'new_string' => '$b = 22;',
        ]);

        $this->assertStringContainsString('--- a/app/diff.php', $preview);
        $this->assertStringContainsString('+++ b/app/diff.php', $preview);
        $this->assertStringContainsString('@@', $preview);
        $this->assertStringContainsString('-$b = 2;', $preview);
        $this->assertStringContainsString('+$b = 22;', $preview);
        // Kontext ostáva bez znamienka, takže sa nedá zmeniť s pridaným riadkom.
        $this->assertStringContainsString(' $a = 1;', $preview);
    }

    public function test_write_file_preview_shows_a_diff_for_existing_and_full_content_for_new(): void
    {
        $this->putFile('app/exists.php', "<?php\n\nreturn 'staré';\n");

        $overwrite = (string) $this->registry()->preview('write_file', [
            'path' => 'app/exists.php', 'content' => "<?php\n\nreturn 'nové';\n",
        ]);
        $this->assertStringContainsString("-return 'staré';", $overwrite);
        $this->assertStringContainsString("+return 'nové';", $overwrite);

        $fresh = (string) $this->registry()->preview('write_file', [
            'path' => 'app/brand-new.php', 'content' => "<?php\n\nreturn 1;\n",
        ]);
        $this->assertStringContainsString('--- /dev/null', $fresh);
        $this->assertStringContainsString('+return 1;', $fresh);
    }

    public function test_write_file_refuses_identical_content(): void
    {
        $this->putFile('app/idem.php', "<?php\n");

        $result = $this->registry()->call('write_file', ['path' => 'app/idem.php', 'content' => "<?php\n"]);

        $this->assertTrue($result->failed);
    }

    // ---- 6. zápis do pamäte --------------------------------------------------

    /**
     * Slabý lokálny model je presne ten pisateľ, ktorý pošle ako `label` prvých N
     * znakov promptu. Tu sa to zastaví — a to isté sito používa recall na
     * označovanie existujúceho odpadu, takže je jeden kánon, nie druhá kópia.
     */
    public function test_mind_learn_refuses_a_raw_prompt_label(): void
    {
        $result = $this->registry()->call('mind_learn', [
            'type' => 'memory',
            'label' => 'potrebujem aby si mi opravil ten docker kontejner a nasadil to na server',
            'description' => 'Dlhý a zmysluplný popis, ktorý by sám o sebe prešiel bez problémov.',
            'area' => 'Vývoj / kód',
        ]);

        $this->assertTrue($result->failed);
        $this->assertStringContainsString('sentence', $result->text);
        $this->assertSame(0, Node::count());
    }

    public function test_mind_learn_refuses_markdown_in_a_label(): void
    {
        foreach (['# Smernica: nasadenie', '**Docker** v Hadese', '`mind_recall`'] as $label) {
            $result = $this->registry()->call('mind_learn', [
                'type' => 'skill',
                'label' => $label,
                'description' => 'Popis, ktorý je dostatočne dlhý na to, aby nebol stub.',
                'area' => 'Vývoj / kód',
            ]);

            $this->assertTrue($result->failed, "label {$label} mal byť odmietnutý");
            $this->assertStringContainsString('markdown', $result->text);
        }

        $this->assertSame(0, Node::count());
    }

    public function test_mind_learn_refuses_an_empty_or_stub_description(): void
    {
        $empty = $this->registry()->call('mind_learn', [
            'type' => 'skill', 'label' => 'Ollama na CPU', 'description' => '   ', 'area' => 'Vývoj / kód',
        ]);
        $this->assertTrue($empty->failed);
        $this->assertStringContainsString('empty', $empty->text);

        $stub = $this->registry()->call('mind_learn', [
            'type' => 'skill', 'label' => 'Ollama na CPU', 'description' => 'krátke', 'area' => 'Vývoj / kód',
        ]);
        $this->assertTrue($stub->failed);
        $this->assertStringContainsString('too short', $stub->text);

        $this->assertSame(0, Node::count());
    }

    /** Poistka blacklistu je serverová — nesmie závisieť od toho, čo klikne človek. */
    public function test_mind_learn_refuses_a_secret(): void
    {
        $result = $this->registry()->call('mind_learn', [
            'type' => 'memory',
            'label' => 'API kľúč pre Anthropic',
            'description' => 'Kľúč je sk-ant-'.str_repeat('a', 40).' a používa sa v konzole.',
            'area' => 'Vývoj / kód',
        ]);

        $this->assertTrue($result->failed);
        $this->assertSame(0, Node::count());
    }

    public function test_mind_learn_stores_a_clean_node(): void
    {
        $result = $this->registry()->call('mind_learn', [
            'type' => 'skill',
            'label' => 'Ollama na CPU bez GPU',
            'description' => 'MoE model s ~3B aktívnymi parametrami beží na CPU rýchlejšie než hustý 8B.',
            'area' => 'Vývoj / kód',
            'tags' => ['ollama', 'cpu'],
            'certainty' => 'overene',
        ]);

        $this->assertFalse($result->failed);
        $node = Node::firstOrFail();
        $this->assertSame('Ollama na CPU bez GPU', $node->label);
        $this->assertSame('overene', $node->certainty);
        $this->assertEqualsCanonicalizing(['ollama', 'cpu'], $node->tags->pluck('name')->all());
    }

    public function test_mind_rename_refuses_a_junk_new_label_and_fixes_a_junk_one(): void
    {
        $node = Node::create([
            'type' => 'skill', 'area_id' => Area::firstOrFail()->id,
            'label' => '# Smernica: nasadenie do dockeru',
            'description' => 'Popis, ktorý je dostatočne dlhý na to, aby nebol stub.',
            'strength' => 1,
        ]);

        $junk = $this->registry()->call('mind_rename', [
            'id' => $node->id, 'new_label' => '## Ešte horší názov',
        ]);
        $this->assertTrue($junk->failed);
        $this->assertSame('# Smernica: nasadenie do dockeru', $node->fresh()->label);

        $ok = $this->registry()->call('mind_rename', [
            'id' => $node->id, 'new_label' => 'Nasadenie Hadesa do Dockeru',
        ]);
        $this->assertFalse($ok->failed);
        $this->assertSame('Nasadenie Hadesa do Dockeru', $node->fresh()->label);
    }

    public function test_mind_move_refuses_an_unknown_area(): void
    {
        $node = Node::create([
            'type' => 'skill', 'area_id' => Area::firstOrFail()->id, 'label' => 'Docker Compose',
            'description' => 'Popis dostatočne dlhý na to, aby nebol stub.', 'strength' => 1,
        ]);

        $result = $this->registry()->call('mind_move', ['id' => $node->id, 'area' => 'Neexistujúca oblasť']);

        $this->assertTrue($result->failed);
        $this->assertSame(Area::firstOrFail()->id, $node->fresh()->area_id);
    }

    /**
     * Mazanie MUSÍ ísť vratnou cestou. Pamäť je jediná kópia a model, ktorý sa
     * mýli v tom, čo je odpad, nesmie mať v ruke nevratnú operáciu. Náhrobok nie
     * je kozmetika: bez neho by najbližší ingest ten istý `external_key` znovu
     * adoptoval a odpad by sa vrátil.
     */
    public function test_mind_delete_soft_deletes_and_writes_a_tombstone(): void
    {
        $node = Node::create([
            'type' => 'memory', 'area_id' => Area::firstOrFail()->id, 'label' => 'Odpadový uzol',
            'description' => 'Popis dostatočne dlhý na to, aby nebol stub.', 'strength' => 1,
            'external_key' => 'session:abc',
        ]);

        $result = $this->registry()->call('mind_delete', ['id' => $node->id, 'reason' => 'test']);

        $this->assertFalse($result->failed);
        $this->assertStringContainsString('reversible', $result->text);

        // Riadok v tabuľke ostal, len je soft-zmazaný.
        $this->assertNull(Node::find($node->id));
        $trashed = Node::withTrashed()->find($node->id);
        $this->assertNotNull($trashed);
        $this->assertNotNull($trashed->deleted_at);

        $this->assertTrue(Tombstone::where('external_key', 'session:abc')->exists());
    }

    public function test_mind_delete_preview_shows_what_disappears(): void
    {
        $node = Node::create([
            'type' => 'memory', 'area_id' => Area::firstOrFail()->id, 'label' => 'Uzol na zmazanie',
            'description' => 'Táto znalosť musí byť v náhľade vidieť pred potvrdením.', 'strength' => 1,
        ]);

        $preview = (string) $this->registry()->preview('mind_delete', ['id' => $node->id]);

        $this->assertStringContainsString('Uzol na zmazanie', $preview);
        $this->assertStringContainsString('musí byť v náhľade', $preview);
        $this->assertStringContainsString('vratné', $preview);
    }

    // ---- 7. tvar pre jazykovú vrstvu ----------------------------------------

    /**
     * Definície idú do `$options['tools']` poskytovateľa. Keď sa tvar rozíde,
     * model nedostane ŽIADNE tooly a konzola sa zmení na obyčajný chat — bez
     * jedinej chybovej správy.
     */
    public function test_registry_exposes_definitions_in_the_shape_the_llm_layer_expects(): void
    {
        $definitions = $this->registry()->definitions();

        $this->assertCount(count(ToolRegistry::TOOLS), $definitions);

        foreach ($definitions as $definition) {
            $this->assertSame(['name', 'description', 'input_schema'], array_keys($definition));
            $this->assertMatchesRegularExpression('/^[a-z][a-z0-9_]*$/', $definition['name']);

            // Popis je páka na to, či slabý model tool použije správne — prázdny
            // alebo jednoslovný popis je vada, nie štýl.
            $this->assertGreaterThan(80, strlen($definition['description']), $definition['name']);

            $schema = $definition['input_schema'];
            $this->assertSame('object', $schema['type']);
            $this->assertArrayHasKey('required', $schema, $definition['name']);
            $this->assertIsArray($schema['required']);
            $this->assertArrayHasKey('properties', $schema);

            // Prázdne `properties` musí byť objekt, nie pole — `[]` v JSON-e robí
            // zo schémy pole a poskytovateľ vie odmietnuť celú sadu toolov.
            $encoded = json_encode($schema);
            $this->assertIsString($encoded);
            $this->assertStringNotContainsString('"properties":[]', $encoded);

            $properties = (array) $schema['properties'];

            foreach ($schema['required'] as $required) {
                $this->assertArrayHasKey($required, $properties, "{$definition['name']}.{$required}");
            }

            // Plochá schéma: slabý model si vnorené objekty vymýšľa.
            foreach ($properties as $key => $property) {
                $this->assertArrayHasKey('type', $property, "{$definition['name']}.{$key}");
                $this->assertNotSame('object', $property['type'], "{$definition['name']}.{$key}");
                $this->assertArrayHasKey('description', $property, "{$definition['name']}.{$key}");
            }
        }
    }

    public function test_every_tool_name_matches_its_registry_key(): void
    {
        foreach ($this->registry()->names() as $name) {
            $this->assertSame($name, $this->tool($name)->name());
        }
    }

    /** Čítacie tooly nemajú čo potvrdzovať, takže nesmú predstierať náhľad. */
    public function test_read_tools_have_no_preview(): void
    {
        foreach (['mind_recall', 'mind_read', 'mind_overview', 'read_file', 'glob', 'grep'] as $name) {
            $this->assertNull($this->tool($name)->preview(['path' => 'app', 'query' => 'x', 'pattern' => 'x']));
        }
    }

    // ---- 8. čítanie pamäte --------------------------------------------------

    /**
     * `searchNodes` stojí na MariaDB `COLLATE utf8mb4_unicode_ci` (diakritika
     * v `LIKE`), ktoré sqlite nepozná — na predvolenej sade sa preto preskočí,
     * rovnako ako v RecallForAiTest a HybridRecallTest.
     */
    public function test_mind_recall_returns_a_compact_ai_shaped_list(): void
    {
        $this->skipWithoutMariadb();

        Node::create([
            'type' => 'skill', 'area_id' => Area::firstOrFail()->id, 'label' => 'Ripgrep v konzole',
            'description' => 'Vzor sa posiela ako jeden argv prvok, takže shell ho nikdy nevidí.',
            'strength' => 3,
        ]);

        $result = $this->registry()->call('mind_recall', ['query' => 'ripgrep konzola']);
        $data = json_decode($result->text, true);

        $this->assertFalse($result->failed, $result->text);
        $this->assertSame(1, $data['found']);
        $this->assertSame('Ripgrep v konzole', $data['nodes'][0]['label']);
        // `id` je to, čím sa uzol dá dočítať bez hádania labelu.
        $this->assertArrayHasKey('id', $data['nodes'][0]);
        $this->assertArrayHasKey('relevance', $data['nodes'][0]);
        // Prázdne polia sa neposielajú — na 9 tok/s je každý znak zaplatený token.
        $this->assertArrayNotHasKey('certainty', $data['nodes'][0]);
    }

    public function test_mind_recall_truncates_a_long_description_and_says_so(): void
    {
        $this->skipWithoutMariadb();

        config(['hades.recall_desc_chars' => 60]);

        Node::create([
            'type' => 'skill', 'area_id' => Area::firstOrFail()->id, 'label' => 'Dlhý uzol o ripgrepe',
            'description' => str_repeat('Ripgrep hľadá v obsahu súborov a je rýchly. ', 20),
            'strength' => 1,
        ]);

        $data = json_decode($this->registry()->call('mind_recall', ['query' => 'ripgrep'])->text, true);

        $this->assertTrue($data['nodes'][0]['description_truncated']);
        $this->assertLessThan(80, mb_strlen($data['nodes'][0]['description']));
    }

    public function test_mind_read_returns_the_whole_description(): void
    {
        $long = str_repeat('Celý popis bez stropu. ', 40);
        $node = Node::create([
            'type' => 'skill', 'area_id' => Area::firstOrFail()->id, 'label' => 'Uzol na dočítanie',
            'description' => $long, 'strength' => 1,
        ]);

        $data = json_decode($this->registry()->call('mind_read', ['id' => $node->id])->text, true);

        $this->assertSame(trim($long), $data['description']);
        $this->assertSame('Vývoj / kód', $data['area']);
    }

    public function test_mind_read_refuses_an_unknown_node(): void
    {
        $this->assertTrue($this->registry()->call('mind_read', ['id' => 999999])->failed);
        $this->assertTrue($this->registry()->call('mind_read', [])->failed);
    }

    public function test_mind_overview_lists_areas_and_totals(): void
    {
        $data = json_decode($this->registry()->call('mind_overview', [])->text, true);

        $this->assertSame('Vývoj / kód', $data['areas'][0]['name']);
        $this->assertArrayHasKey('node_types', $data);
        $this->assertArrayHasKey('needs_review', $data['totals']);
    }
}
