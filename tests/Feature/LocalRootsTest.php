<?php

namespace Tests\Feature;

use App\Models\BrainSource;
use App\Models\Node;
use App\Models\SyncRun;
use App\Services\Console\Roots;
use App\Services\Console\Tools\PathGuard;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\File;
use Tests\TestCase;

/**
 * Lokálne korene a indexovanie lokálnych dokumentov (kontrakt §3 „Lokálne dáta").
 *
 * Čo tento test naozaj chráni — appka je verejne tunelovaná cez ngrok, takže
 * každý nový koreň je nová útočná plocha:
 *
 *  1. **Cesta mimo koreňov nepatrí nikomu.** `Roots::owning()` na ňu vráti
 *     `null` a guard z toho robí odmietnutie. Sanitizácia sa netestuje, pretože
 *     neexistuje.
 *  2. **Symlink von z koreňa sa rozbalí a odmietne** — rozhoduje cieľ, nie zápis
 *     cesty. Test ho vyrába naostro; keď prostredie symlinky nedovolí, preskočí
 *     sa LEN on.
 *  3. **Indexovanie je idempotentné.** Druhý beh nesmie založiť ani jeden uzol.
 *     Bez toho by scheduler každých desať minút vyrobil kópiu celého priečinka.
 *  4. **Do pamäte sa nedostane, čo tam nemá byť**: `.env`, `.git`, `vendor`,
 *     `node_modules`, skryté priečinky, prílohy chatu, odpad podľa
 *     `MindService::noiseOf()` a text so vzorom tajomstva.
 */
class LocalRootsTest extends TestCase
{
    use RefreshDatabase;

    private string $tmp;

    private string $project;

    private string $docs;

    protected function setUp(): void
    {
        parent::setUp();

        // Rozložená (`realpath`) cesta: `sys_get_temp_dir()` býva symlink a celá
        // trieda porovnáva rozložené cesty — bez toho by zlyhalo všetko naraz.
        $base = realpath(sys_get_temp_dir()).'/hades-roots-'.bin2hex(random_bytes(4));

        File::ensureDirectoryExists($base.'/project');
        File::ensureDirectoryExists($base.'/docs');

        $this->tmp = (string) realpath($base);
        $this->project = (string) realpath($base.'/project');
        $this->docs = (string) realpath($base.'/docs');

        config([
            'cache.default' => 'array',
            'hades.console.files_root' => $this->project,
            'hades.console.roots' => [],
            'hades.console.attachments_root' => $this->project.'/storage/app/console-attachments',
            'hades.local_index.extensions' => ['md', 'markdown', 'txt'],
            'hades.local_index.max_bytes' => 512000,
        ]);
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->tmp);

        parent::tearDown();
    }

    // ------------------------------------------------------------------
    // pomôcky
    // ------------------------------------------------------------------

    /** Nová instancia — `Roots` si zoznam memoizuje, takže po zmene configu treba čerstvú. */
    private function roots(): Roots
    {
        return new Roots;
    }

    /** Nakonfiguruje koreň `docs` (read-only, indexovaný). */
    private function useDocsRoot(array $overrides = []): void
    {
        config(['hades.console.roots' => [
            'docs' => array_merge([
                'path' => $this->docs,
                'label' => 'Dokumenty',
                'writable' => false,
                'index' => true,
            ], $overrides),
        ]]);
    }

    private function write(string $relative, string $content): string
    {
        $path = $this->docs.'/'.$relative;
        File::ensureDirectoryExists(dirname($path));
        File::put($path, $content);

        return $path;
    }

    /** Dokument, ktorý klasifikátorom odpadu prejde (label je meno, popis dosť dlhý). */
    private function document(string $name, string $description): string
    {
        return "---\nname: {$name}\n---\n# {$name}\n\n{$description}\n";
    }

    private function index(array $options = []): int
    {
        return $this->artisan('mind:index-docs', $options)->run();
    }

    // ------------------------------------------------------------------
    // 1. korene
    // ------------------------------------------------------------------

    public function test_without_configuration_there_is_exactly_one_root(): void
    {
        $roots = $this->roots();

        $this->assertCount(1, $roots->all(), 'Bez hades.console.roots sa nesmie objaviť druhý koreň');
        $this->assertSame(Roots::DEFAULT_NAME, $roots->all()[0]['name']);
        $this->assertSame($this->project, $roots->all()[0]['path']);
        $this->assertTrue($roots->all()[0]['writable'], 'Projekt zostáva zapisovateľný');
        $this->assertFalse($roots->all()[0]['index'], 'Projekt sa neindexuje — jeho .md berie brain-sync');
    }

    public function test_named_root_is_read_only_unless_it_says_otherwise(): void
    {
        $this->useDocsRoot();

        $docs = $this->roots()->byName('docs');

        $this->assertNotNull($docs);
        $this->assertSame($this->docs, $docs['path']);
        $this->assertFalse($docs['writable'], 'Nový koreň je read-only, kým sa nepovie inak');

        config(['hades.console.roots' => [
            'docs' => ['path' => $this->docs, 'writable' => true],
        ]]);

        $this->assertTrue($this->roots()->byName('docs')['writable']);
    }

    public function test_a_path_outside_every_root_belongs_to_no_root(): void
    {
        $this->useDocsRoot();

        $roots = $this->roots();

        // Vnútri koreňov
        $this->assertSame('docs', $roots->owning($this->docs.'/a.md')['name']);
        $this->assertSame(Roots::DEFAULT_NAME, $roots->owning($this->project.'/app/X.php')['name']);

        // Mimo všetkých koreňov — `null` je to, z čoho guard robí odmietnutie
        foreach (['/etc/passwd', '/etc', $this->tmp.'/secrets.txt', $this->tmp] as $outside) {
            $this->assertNull($roots->owning($outside), "{$outside} nesmie patriť žiadnemu koreňu");
        }
    }

    public function test_nested_root_wins_so_it_can_narrow_and_never_widen(): void
    {
        File::ensureDirectoryExists($this->project.'/data');

        config(['hades.console.roots' => [
            'data' => ['path' => $this->project.'/data', 'writable' => false],
        ]]);

        $owner = $this->roots()->owning($this->project.'/data/x.md');

        $this->assertSame('data', $owner['name'], 'Pri vnorení vyhráva najdlhšia zhoda');
        $this->assertFalse($owner['writable'], 'Vnorený read-only koreň zužuje, nie rozširuje');
    }

    public function test_broken_roots_are_rejected_with_a_reason_and_never_repaired(): void
    {
        File::ensureDirectoryExists($this->project.'/storage/app/console-attachments/thread');

        config(['hades.console.roots' => [
            'chybi' => ['path' => $this->tmp.'/neexistuje'],
            'project' => ['path' => $this->docs],
            'X' => ['path' => $this->docs],
            'prilohy' => ['path' => $this->project.'/storage/app/console-attachments'],
            'skryte' => ['path' => $this->tmp],
        ]]);

        $roots = $this->roots();
        $rejected = $roots->rejected();

        // Kalibrácia na známom kladnom prípade: validátor, ktorý odmieta všetko,
        // by inak vyzeral ako bezchybný.
        $this->assertArrayNotHasKey('skryte', $rejected, 'Bežný existujúci priečinok musí prejsť');
        $this->assertNotNull($roots->byName('skryte'));

        $this->assertArrayHasKey('chybi', $rejected);
        $this->assertArrayHasKey('project', $rejected, 'Meno implicitného koreňa je vyhradené');
        $this->assertArrayHasKey('X', $rejected, 'Veľké písmeno v mene sa odmieta');
        $this->assertArrayHasKey('prilohy', $rejected, 'Koreň v priečinku príloh sa odmieta');

        $this->assertNull($roots->byName('chybi'));
        $this->assertNull($roots->byName('prilohy'));
        $this->assertSame($this->project, $roots->default()['path'], 'Vyhradené meno nesmie prepísať projekt');
    }

    public function test_root_whose_own_path_is_hidden_or_denied_is_rejected(): void
    {
        File::ensureDirectoryExists($this->tmp.'/.ssh');
        File::ensureDirectoryExists($this->tmp.'/vendor/pkg');

        config(['hades.console.roots' => [
            'kluce' => ['path' => $this->tmp.'/.ssh'],
            'balik' => ['path' => $this->tmp.'/vendor/pkg'],
            'docs' => ['path' => $this->docs],
        ]]);

        $roots = $this->roots();
        $rejected = $roots->rejected();

        // Kalibrácia: `docs` je známy kladný prípad a musí prejsť.
        $this->assertNotNull($roots->byName('docs'));

        $this->assertArrayHasKey('kluce', $rejected);
        $this->assertArrayHasKey('balik', $rejected);
        $this->assertStringContainsString('.ssh', $rejected['kluce']);
        $this->assertStringContainsString('vendor', $rejected['balik']);
    }

    public function test_named_prefix_is_parsed_and_a_windows_drive_is_left_alone(): void
    {
        $this->useDocsRoot();

        $roots = $this->roots();

        $named = $roots->split('docs:notes/a.md');
        $this->assertSame('docs', $named['name']);
        $this->assertSame('notes/a.md', $named['path']);
        $this->assertNotNull($named['root']);

        // Neznámy koreň: meno je, koreň nie → volajúci to má odmietnuť
        $unknown = $roots->split('tajne:x.md');
        $this->assertSame('tajne', $unknown['name']);
        $this->assertNull($unknown['root']);

        // Windows disk ani dvojbodka v názve súboru nie sú prefix koreňa
        foreach (['C:/Users/Ucet/x.md', 'c:/tmp/x.md', 'notes/a:b.md'] as $path) {
            $this->assertNull($roots->split($path)['name'], "{$path} nie je prefix koreňa");
        }
    }

    public function test_label_prefixes_paths_from_other_roots(): void
    {
        $this->useDocsRoot();

        $roots = $this->roots();

        // Implicitný koreň hovorí presne to, čo hovoril doteraz — bez prefixu.
        $this->assertSame('app/X.php', $roots->label($this->project.'/app/X.php'));
        // Cudzí koreň musí byť v odpovedi vidieť, inak sa cesta nedá vrátiť späť.
        $this->assertSame('docs:notes/a.md', $roots->label($this->docs.'/notes/a.md'));
    }

    // ------------------------------------------------------------------
    // 2. enumerácia — čo sa vôbec nedostane k indexovaniu
    // ------------------------------------------------------------------

    public function test_enumeration_skips_denied_and_foreign_files(): void
    {
        $this->useDocsRoot();

        $this->write('ok.md', $this->document('Docker', 'Kontajnery a ich siete v projekte.'));
        $this->write('.env', "APP_KEY=base64:xxxx\n");
        $this->write('.hidden/tajne.md', $this->document('Tajne', 'Nemá sa indexovať vôbec.'));
        $this->write('.git/config', "[core]\n");
        $this->write('vendor/balik/readme.md', $this->document('Balik', 'Cudzia závislosť, nie poznatok.'));
        $this->write('node_modules/lib/readme.md', $this->document('Lib', 'Cudzia závislosť, nie poznatok.'));
        $this->write('obrazok.png', 'PNG');

        $paths = array_column($this->roots()->files($this->roots()->byName('docs')), 'rel_path');

        $this->assertSame(['ok.md'], $paths);
    }

    public function test_attachments_root_is_denied_under_every_root(): void
    {
        // Koreň nastavený NAD priečinok príloh: relatívny prefix
        // `storage/app/console-attachments` by tu nesedel, absolútny áno.
        File::ensureDirectoryExists($this->project.'/storage/app/console-attachments/vlakno');
        File::put($this->project.'/storage/app/console-attachments/vlakno/priloha.md', $this->document('Priloha', 'Súbor cudzieho vlákna.'));
        File::put($this->project.'/storage/app/verejne.md', $this->document('Verejne', 'Bežný dokument v storage/app.'));

        config(['hades.console.roots' => [
            'appdata' => ['path' => $this->project.'/storage/app', 'index' => true],
        ]]);

        $roots = $this->roots();
        $paths = array_column($roots->files($roots->byName('appdata')), 'rel_path');

        $this->assertSame(['verejne.md'], $paths, 'Prílohy chatu sa neindexujú ani z koreňa nad nimi');
    }

    public function test_symlink_leaving_the_root_is_not_enumerated(): void
    {
        $this->useDocsRoot();

        $outside = $this->tmp.'/mimo.md';
        File::put($outside, $this->document('Mimo', 'Tento súbor je mimo koreňa.'));

        if (! @symlink($outside, $this->docs.'/utek.md')) {
            $this->markTestSkipped('Prostredie nedovolí vytvoriť symlink.');
        }

        $this->write('ok.md', $this->document('Docker', 'Kontajnery a ich siete v projekte.'));

        $paths = array_column($this->roots()->files($this->roots()->byName('docs')), 'rel_path');

        $this->assertSame(['ok.md'], $paths, 'Symlink von z koreňa sa musí rozbaliť a odmietnuť');
    }

    public function test_symlinked_directory_leaving_the_root_is_not_enumerated(): void
    {
        $this->useDocsRoot();

        File::ensureDirectoryExists($this->tmp.'/mimo');
        File::put($this->tmp.'/mimo/tajne.md', $this->document('Tajne', 'Nemá sa indexovať vôbec.'));

        if (! @symlink($this->tmp.'/mimo', $this->docs.'/vetva')) {
            $this->markTestSkipped('Prostredie nedovolí vytvoriť symlink.');
        }

        $this->assertSame([], $this->roots()->files($this->roots()->byName('docs')));
    }

    public function test_deny_rules_agree_with_pathguard(): void
    {
        // PathGuard drží (kým ho niekto nenapojí na Roots) vlastnú kópiu tých
        // istých pravidiel. Dve kópie bezpečnostného pravidla sa rozídu — tento
        // test to zachytí. Keď kópia v PathGuarde zmizne, kontrola sa preskočí,
        // pretože už nie je čo rozísť.
        $guard = new \ReflectionClass(PathGuard::class);
        $constants = $guard->getConstants();

        if (! isset($constants['DENY_SEGMENTS']) && ! isset($constants['DENY_PREFIXES'])) {
            $this->assertTrue(true, 'PathGuard už vlastnú kópiu pravidiel nedrží.');

            return;
        }

        if (isset($constants['DENY_SEGMENTS'])) {
            $this->assertSame(
                $constants['DENY_SEGMENTS'],
                Roots::DENY_SEGMENTS,
                'PathGuard::DENY_SEGMENTS a Roots::DENY_SEGMENTS sa rozišli',
            );
        }

        if (isset($constants['DENY_PREFIXES'])) {
            $this->assertSame(
                $constants['DENY_PREFIXES'],
                Roots::DENY_PREFIXES,
                'PathGuard::DENY_PREFIXES a Roots::DENY_PREFIXES sa rozišli',
            );
        }
    }

    // ------------------------------------------------------------------
    // 3. indexovanie
    // ------------------------------------------------------------------

    public function test_index_creates_nodes_and_the_second_run_creates_nothing(): void
    {
        $this->useDocsRoot();
        $this->write('docker.md', $this->document('Docker', 'Kontajnery a ich siete v projekte.'));
        // `.txt` nemá frontmatter ani nadpis: label vyjde z názvu súboru, popis
        // z prvého odseku — preto musí byť prvý riadok veta, nie jedno slovo.
        $this->write('notes/redis.txt', "Redis drží cache a fronty pre celú appku.\n\nDetaily nižšie.\n");

        $this->assertSame(0, $this->index());
        $this->assertSame(2, Node::where('source', 'local-doc')->count());

        $before = Node::where('source', 'local-doc')->orderBy('id')->pluck('content_hash', 'external_key');

        $this->assertSame(0, $this->index());
        $this->assertSame(2, Node::where('source', 'local-doc')->count(), 'Druhý beh nesmie založiť duplikát');
        $this->assertEquals(
            $before,
            Node::where('source', 'local-doc')->orderBy('id')->pluck('content_hash', 'external_key'),
            'Nezmenený súbor nesmie zmeniť odtlačok ani identitu uzla',
        );
    }

    public function test_index_stores_identity_that_survives_an_edit(): void
    {
        $this->useDocsRoot();
        $this->write('docker.md', $this->document('Docker', 'Kontajnery a ich siete v projekte.'));

        $this->index();

        $node = Node::where('source', 'local-doc')->firstOrFail();
        $node->forceFill(['strength' => 7.5])->save();

        $key = $node->external_key;
        $hash = $node->content_hash;

        $this->write('docker.md', $this->document('Docker', 'Kontajnery, siete a zväzky v projekte.'));
        $this->index();

        $node->refresh();

        $this->assertSame(1, Node::where('source', 'local-doc')->count(), 'Edit textu nie je nový uzol');
        $this->assertSame($key, $node->external_key, 'Identita je relatívna cesta, nie obsah');
        $this->assertNotSame($hash, $node->content_hash, 'Zmenený obsah musí dať nový odtlačok');
        $this->assertSame(7.5, $node->strength, 'Sila je história aktivácií — indexovanie ju neresetuje');
    }

    public function test_index_skips_noise_and_texts_that_look_like_secrets(): void
    {
        $this->useDocsRoot();

        $this->write('ok.md', $this->document('Docker', 'Kontajnery a ich siete v projekte.'));
        // useknutá veta — noiseOf() → raw-prompt
        $this->write('prompt.md', $this->document('urob mi prosím appku ktorá bude vedieť posielať maily a', 'Toto je surový prompt, nie poznatok.'));
        // krátky popis — noiseOf() → stub
        $this->write('stub.md', $this->document('Torzo', 'Krátke.'));
        // vzor tajomstva v popise
        $this->write('kluc.md', $this->document('Kľúč k API', 'Kľúč je sk-ant-abcdefghijklmnop a nemá sa nikde ukladať.'));

        $this->index();

        $labels = Node::where('source', 'local-doc')->pluck('label')->all();

        $this->assertSame(['Docker'], $labels);
    }

    public function test_index_skips_hades_own_export(): void
    {
        $this->useDocsRoot();

        $this->write('zrkadlo.md', "---\nnode_id: 421\nname: Zrkadlo\n---\n# Zrkadlo\n\nExport Hadesa, nie zdroj.\n");
        $this->write('ok.md', $this->document('Docker', 'Kontajnery a ich siete v projekte.'));

        $this->index();

        $this->assertSame(1, Node::where('source', 'local-doc')->count());
        $this->assertNull(Node::where('label', 'Zrkadlo')->first(), 'Vlastný export sa nesmie zaindexovať späť');
    }

    public function test_index_skips_identical_content_in_two_places(): void
    {
        $this->useDocsRoot();

        $same = $this->document('Docker', 'Kontajnery a ich siete v projekte.');
        $this->write('a/docker.md', $same);
        $this->write('b/docker.md', $same);

        $this->index();

        $this->assertSame(1, Node::where('source', 'local-doc')->count(), 'Rovnaký obsah = jeden uzol, nie kolízia na UNIQUE');
    }

    public function test_index_skips_files_over_the_cap(): void
    {
        $this->useDocsRoot();
        config(['hades.local_index.max_bytes' => 64]);

        $this->write('velky.md', $this->document('Velky', str_repeat('Dlhý dokument. ', 40)));

        $this->index();

        $this->assertSame(0, Node::where('source', 'local-doc')->count());
    }

    public function test_index_does_nothing_for_roots_without_the_index_flag(): void
    {
        $this->useDocsRoot(['index' => false]);
        $this->write('docker.md', $this->document('Docker', 'Kontajnery a ich siete v projekte.'));

        $this->assertSame(0, $this->index());
        $this->assertSame(0, Node::where('source', 'local-doc')->count());
        $this->assertSame(0, SyncRun::count(), 'Bez indexovaného koreňa sa beh ani nezačne');
    }

    public function test_unknown_root_option_fails_instead_of_indexing_everything(): void
    {
        $this->useDocsRoot();
        $this->write('docker.md', $this->document('Docker', 'Kontajnery a ich siete v projekte.'));

        $this->assertSame(1, $this->index(['--root' => 'ine']));
        $this->assertSame(0, Node::where('source', 'local-doc')->count());
    }

    public function test_dry_run_writes_nothing(): void
    {
        $this->useDocsRoot();
        $this->write('docker.md', $this->document('Docker', 'Kontajnery a ich siete v projekte.'));

        $this->assertSame(0, $this->index(['--dry-run' => true]));

        $this->assertSame(0, Node::where('source', 'local-doc')->count());
        $this->assertSame(0, BrainSource::count());
        $this->assertSame(0, SyncRun::count());
    }

    // ------------------------------------------------------------------
    // 4. sledovanie zmien — stav v DB
    // ------------------------------------------------------------------

    public function test_index_records_its_state_in_the_database(): void
    {
        $this->useDocsRoot();
        $this->write('docker.md', $this->document('Docker', 'Kontajnery a ich siete v projekte.'));

        $this->index();

        $source = BrainSource::where('key', 'root:docs')->first();

        $this->assertNotNull($source, 'Koreň musí mať stav v brain_sources — inak nie je čo sledovať');
        $this->assertSame('local-root', $source->type);
        $this->assertSame($this->docs, $source->path);
        $this->assertFalse($source->writable);
        $this->assertNotNull($source->last_synced_at);

        $run = SyncRun::latest('id')->first();

        $this->assertNotNull($run);
        $this->assertSame('ok', $run->status);
        $this->assertSame(1, $run->stats['created']);
    }

    public function test_a_vanished_document_is_flagged_for_review_never_deleted(): void
    {
        $this->useDocsRoot();
        $this->write('docker.md', $this->document('Docker', 'Kontajnery a ich siete v projekte.'));
        $this->write('redis.md', $this->document('Redis', 'Cache a fronty pre celú appku.'));

        $this->index();

        File::delete($this->docs.'/redis.md');

        $this->index();

        $this->assertSame(2, Node::where('source', 'local-doc')->count(), 'Zmiznutý súbor sa NEMAŽE');
        $this->assertTrue(Node::where('label', 'Redis')->firstOrFail()->needs_review);
        $this->assertFalse(Node::where('label', 'Docker')->firstOrFail()->needs_review);
    }

    public function test_an_incomplete_run_flags_nothing_and_claims_no_sync(): void
    {
        $this->useDocsRoot();

        foreach (['a', 'b', 'c'] as $name) {
            $this->write("{$name}.md", $this->document(strtoupper($name).' dokument', "Popis dokumentu {$name} pre test."));
        }

        // Neúplný prvý prechod: prejde jeden súbor z troch.
        $this->index(['--limit' => 1]);

        $this->assertSame(1, Node::where('source', 'local-doc')->count());
        $this->assertSame(0, Node::where('needs_review', true)->count(), 'Neprejdený súbor nie je zmiznutý súbor');
        $this->assertNull(
            BrainSource::where('key', 'root:docs')->firstOrFail()->last_synced_at,
            'Neúplný prechod nesmie tvrdiť, že koreň je zosynchronizovaný',
        );

        // Prerušený beh sa dá dokončiť ďalším behom — nič sa nestratilo.
        $this->index();

        $this->assertSame(3, Node::where('source', 'local-doc')->count());
        $this->assertNotNull(BrainSource::where('key', 'root:docs')->firstOrFail()->last_synced_at);
    }
}
