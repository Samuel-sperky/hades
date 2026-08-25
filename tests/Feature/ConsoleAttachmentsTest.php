<?php

namespace Tests\Feature;

use App\Http\Controllers\Console\AttachmentController;
use App\Models\ConsoleAttachment;
use App\Models\ConsoleMessage;
use App\Models\ConsoleThread;
use App\Services\Console\Attachments;
use App\Services\Console\ToolRegistry;
use App\Services\Console\Tools\PathGuard;
use App\Services\Console\Tools\ToolRefusal;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use Tests\TestCase;

/**
 * Prílohy chatu — upload, whitelist, text do promptu, zametanie.
 *
 * Súbor je usporiadaný podľa toho, čo sa môže pokaziť, nie podľa tried:
 *
 *  1. **§5/6 kontraktu:** koreň príloh je pre súborové tooly modelu zakázaný,
 *     a riadok, ktorého cesta vedie von, sa odmietne.
 *  2. Whitelist typov, stropy veľkosti a počtu, náhodné meno na disku.
 *  3. Text do kontextu: strop a priznané skrátenie.
 *  4. Mazanie a zametanie: súbor prežije mazanie riadku, priečinok zmazaného
 *     vlákna neprežije.
 *
 * `files_root` aj koreň príloh sú v každom teste v dočasnom priečinku — a koreň
 * príloh leží POD `files_root`, presne ako v nasadení. Práve tá poloha je dôvod,
 * prečo §5/6 vôbec existuje: keby bol koreň príloh v teste inde, test by dokázal
 * niečo iné, než v čom appka beží.
 */
class ConsoleAttachmentsTest extends TestCase
{
    use RefreshDatabase;

    private string $root;

    private string $attachmentsRoot;

    protected function setUp(): void
    {
        parent::setUp();

        // Rozložená cesta: `sys_get_temp_dir()` býva symlink a oba guardy
        // porovnávajú rozložené cesty.
        $base = realpath(sys_get_temp_dir()).'/hades-attach-'.bin2hex(random_bytes(4));
        File::makeDirectory($base.'/app', 0777, true);
        $this->root = (string) realpath($base);
        $this->attachmentsRoot = $this->root.'/storage/app/console-attachments';

        File::put($this->root.'/.env', "HADES_UI_TOKEN=tajne\n");

        config([
            'cache.default' => 'array',
            'hades.console.files_root' => $this->root,
            'hades.console.attachments_root' => $this->attachmentsRoot,
            'hades.embeddings.enabled' => false,
        ]);
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->root);

        parent::tearDown();
    }

    // ---- pomôcky -----------------------------------------------------------

    private function thread(): ConsoleThread
    {
        return ConsoleThread::create(['provider' => 'ollama']);
    }

    private function attachments(): Attachments
    {
        return app(Attachments::class);
    }

    private function upload(ConsoleThread $thread, string $name, string $content): ConsoleAttachment
    {
        return $this->attachments()->store($thread, $this->uploadedFile($name, $content));
    }

    /**
     * Nahraný súbor SKUTOČNÝM `UploadedFile`om, nie `UploadedFile::fake()`.
     *
     * PASCA: `Illuminate\Http\Testing\File::getMimeType()` hlási typ podľa
     * PRÍPONY (`MimeType::from($name)`), takže s fake súborom by celá táto sada
     * dokazovala detekciu podľa mena — teda presne to, čo appka odmieta robiť,
     * a whitelist by v teste vyzeral funkčne aj vtedy, keby sa na server prestal
     * pozerať. Skutočný `UploadedFile` v testovacom režime číta typ z OBSAHU
     * (finfo) a `move()` urobí `rename`.
     */
    private function uploadedFile(string $name, string $content): UploadedFile
    {
        $directory = $this->root.'/upload-tmp';
        File::ensureDirectoryExists($directory);

        // Dočasné meno je náhodné: meno od „klienta" ide do `$name`, nie do cesty.
        $path = $directory.'/'.bin2hex(random_bytes(6));
        File::put($path, $content);

        return new UploadedFile($path, $name, null, null, true);
    }

    /** 1×1 PNG — obrázok bez závislosti od GD (`fake()->image()` ju potrebuje). */
    private function pngBytes(): string
    {
        return (string) base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
        );
    }

    /** Minimálne PDF s literálnym stringom v obsahovom streame. */
    private function pdfBytes(string $sentence): string
    {
        return "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n"
            ."4 0 obj\nstream\nBT /F1 12 Tf 72 720 Td (".$sentence.") Tj ET\nendstream\nendobj\n"
            ."trailer<</Root 1 0 R>>\n%%EOF\n";
    }

    // ---- 1. §5/6 — súborové tooly a cesty ----------------------------------

    /**
     * Akceptačné kritérium §5/6, prvá polovica.
     *
     * `files_root` je `base_path()` a default koreň príloh leží pod ním, takže
     * bez deny prefixu v {@see PathGuard} by si model vo vlákne A prečítal
     * `read_file`om prílohu vlákna B. Kontroluje sa TEXT odmietnutia, nie len
     * `failed`: „File does not exist" je tiež odmietnutie a test by bol zelený
     * aj s úplne odomknutým priečinkom.
     */
    public function test_file_tools_refuse_the_attachments_directory(): void
    {
        $thread = $this->thread();
        $attachment = $this->upload($thread, 'tajne.txt', "Zmluva a cislo uctu 123456.\n");

        $inside = 'storage/app/console-attachments/'.$thread->uuid.'/'.basename($attachment->path);

        foreach ([
            ['read_file', ['path' => $inside]],
            ['write_file', ['path' => $inside, 'content' => 'x']],
            ['glob', ['pattern' => '**/*', 'path' => 'storage/app/console-attachments']],
            ['grep', ['pattern' => 'Zmluva', 'path' => 'storage/app/console-attachments']],
        ] as [$tool, $args]) {
            $result = app(ToolRegistry::class)->call($tool, $args);

            $this->assertTrue($result->failed, "{$tool} musí byť odmietnutý");
            $this->assertStringContainsString(
                'not readable or writable from the console',
                $result->text,
                "{$tool} musí byť odmietnutý ZÁKAZOM, nie náhodou"
            );
            $this->assertStringNotContainsString('cislo uctu', $result->text);
        }

        // A obsah zostal na disku nedotknutý — `write_file` sa naň nedostal.
        $this->assertSame(
            "Zmluva a cislo uctu 123456.\n",
            File::get($this->attachmentsRoot.'/'.$attachment->path)
        );
    }

    /**
     * Koreň príloh sa dá presunúť configom, takže deny prefix nesmie byť len
     * konštanta s defaultnou cestou — inak by presun ticho odomkol modelu
     * prílohy cudzích vlákien.
     */
    public function test_a_relocated_attachments_root_stays_hidden(): void
    {
        config(['hades.console.attachments_root' => $this->root.'/var/prilohy']);

        $thread = $this->thread();
        $attachment = $this->upload($thread, 'poznamka.txt', "Text prilohy pre model.\n");

        $result = app(ToolRegistry::class)->call('read_file', [
            'path' => 'var/prilohy/'.$attachment->path,
        ]);

        $this->assertTrue($result->failed);
        $this->assertStringContainsString('not readable or writable from the console', $result->text);
    }

    /** Zákaz sa nesmie rozliať na `storage/app` — tam je legitímny obsah. */
    public function test_the_rest_of_storage_app_is_still_readable(): void
    {
        File::ensureDirectoryExists($this->root.'/storage/app');
        File::put($this->root.'/storage/app/report.md', "# Report\n");

        $result = app(ToolRegistry::class)->call('read_file', ['path' => 'storage/app/report.md']);

        $this->assertFalse($result->failed, $result->text);
        $this->assertStringContainsString('# Report', $result->text);
    }

    /**
     * Akceptačné kritérium §5/6, druhá polovica: riadok, ktorého `path` vedie
     * von, sa **odmietne, nesanitizuje**. Sanitizovaná cesta by ticho prečítala
     * niečo iné, než riadok sľubuje.
     */
    public function test_a_row_whose_path_escapes_the_root_is_refused(): void
    {
        $thread = $this->thread();

        foreach (['../../.env', 'storage/../../.env', '/etc/passwd', 'C:/Windows/win.ini'] as $path) {
            $attachment = ConsoleAttachment::create([
                'thread_id' => $thread->id,
                'original_name' => 'x',
                'path' => $path,
                'mime' => 'text/plain',
                'size_bytes' => 10,
            ]);

            try {
                $this->attachments()->absolutePath($attachment);
                $this->fail('cesta '.$path.' sa mala odmietnuť');
            } catch (RuntimeException $e) {
                $this->assertStringContainsString('odmietnut', $e->getMessage());
                // Cieľová cesta nemá čo robiť v hláške ani v logu — to isté
                // pravidlo ako v PathGuarde.
                $this->assertStringNotContainsString($this->root, $e->getMessage());
            }
        }
    }

    public function test_a_symlink_out_of_the_attachments_root_is_refused(): void
    {
        $thread = $this->thread();
        $attachment = $this->upload($thread, 'ok.txt', "obsah prilohy\n");

        $link = $this->attachmentsRoot.'/'.$thread->uuid.'/escape.txt';

        if (! @symlink($this->root.'/.env', $link)) {
            $this->markTestSkipped('Prostredie nedovolí vytvoriť symlink.');
        }

        $attachment->path = $thread->uuid.'/escape.txt';
        $attachment->save();

        $this->expectException(RuntimeException::class);
        $this->attachments()->absolutePath($attachment);
    }

    /**
     * Koreň príloh nastavený cez SYMLINK sa musí zakázať na svojej skutočnej
     * ceste, nie na tej, ktorá je v configu.
     *
     * Lexikálne zloženie by dalo prefix `odkaz`, ktorému by cesta `real/prilohy`
     * nesadla — a model by prílohy prečítal. Preto `deniedPrefixes()` rozkladá
     * `realpath`om, rovnako ako to nad tým istým config kľúčom robí
     * `Roots::deniedAbsolutePrefixes()`.
     *
     * Keby sa zákaz nechytil, `Attachments::store()` odmietne ukladať
     * (fail-closed) — takže dierou to nie je ani v jednom prípade; tento test
     * pinuje ten lepší z tých dvoch stavov.
     */
    public function test_an_attachments_root_behind_a_symlink_is_denied_at_its_real_path(): void
    {
        File::ensureDirectoryExists($this->root.'/real/prilohy');

        if (! @symlink($this->root.'/real/prilohy', $this->root.'/odkaz')) {
            $this->markTestSkipped('Prostredie nedovolí vytvoriť symlink.');
        }

        config(['hades.console.attachments_root' => $this->root.'/odkaz']);

        $this->assertContains('real/prilohy', app(PathGuard::class)->deniedPrefixes());

        $thread = $this->thread();
        $attachment = $this->upload($thread, 'a.txt', "text prilohy\n");

        foreach (['real/prilohy/'.$attachment->path, 'odkaz/'.$attachment->path] as $path) {
            $result = app(ToolRegistry::class)->call('read_file', ['path' => $path]);

            $this->assertTrue($result->failed, "{$path} musí byť odmietnutá");
            $this->assertStringContainsString('not readable or writable from the console', $result->text);
        }
    }

    /** Nastavený koreň príloh sa nesmie dať vyhlásiť za celý koreň súborov. */
    public function test_attachments_root_equal_to_the_files_root_locks_the_file_tools(): void
    {
        config(['hades.console.attachments_root' => $this->root]);

        $this->expectException(ToolRefusal::class);
        app(PathGuard::class)->deniedPrefixes();
    }

    // ---- 2. whitelist, stropy, meno na disku -------------------------------

    public function test_upload_puts_content_on_disk_and_only_metadata_in_the_row(): void
    {
        $thread = $this->thread();
        $content = "Stretnutie o desiatej.\nRozpočet je hotový.\n";

        $attachment = $this->upload($thread, 'poznámky.txt', $content);

        // Prípona sa berie z typu ZISTENÉHO na serveri, nie z názvu súboru.
        $this->assertSame($thread->uuid.'/'.$attachment->uuid.'.txt', $attachment->path);
        $this->assertFileExists($this->attachmentsRoot.'/'.$attachment->path);
        $this->assertSame($content, File::get($this->attachmentsRoot.'/'.$attachment->path));

        // Meno na disku je uuid, nikdy meno od klienta.
        $this->assertStringNotContainsString('poznámky', $attachment->path);
        $this->assertSame('poznámky.txt', $attachment->original_name);

        $this->assertSame(hash('sha256', $content), $attachment->sha256);
        $this->assertSame(strlen($content), $attachment->size_bytes);
        $this->assertNull($attachment->message_id, 'upload je pred odoslaním správy');

        // Text sa vytiahol a je v cache, nie druhou kópiou súboru na disku.
        $this->assertNotNull($attachment->extracted_at);
        $this->assertStringContainsString('Stretnutie o desiatej', (string) $attachment->text_content);
        $this->assertSame('ready', $attachment->textState());
    }

    /**
     * Whitelist, nie blacklist: typ, ktorý appka nemá čím zobraziť, sa neuloží.
     *
     * Vzorky sú BINÁRNE zámerne — ich rozpoznanie nezávisí od verzie libmagic
     * v kontejneri, takže tento test hovorí o whiteliste a nie o `file(1)`.
     * Textové vzorky rieši test nižšie, ktorý je na detekcii nezávislý.
     */
    public function test_types_outside_the_whitelist_are_refused(): void
    {
        $thread = $this->thread();

        foreach ([
            'archiv.zip' => "PK\x03\x04".str_repeat("\x00", 40),
            'binarka.bin' => "\x7fELF\x02\x01\x01\x00".str_repeat("\x00", 40),
        ] as $name => $content) {
            try {
                $this->upload($thread, $name, $content);
                $this->fail("{$name} sa mal odmietnuť");
            } catch (RuntimeException $e) {
                $this->assertStringContainsString('priložiť nedá', $e->getMessage());
            }
        }

        $this->assertSame(0, ConsoleAttachment::count());
        $this->assertSame([], glob($this->attachmentsRoot.'/*/*') ?: []);
    }

    /**
     * Skript sa buď odmietne (typ mimo whitelistu), alebo uloží ako text — ale
     * **nikdy si nenechá svoju príponu**. Prípona na disku sa berie z typu
     * zisteného na serveri, takže `.php`, `.html` ani `.svg` tam vzniknúť nemôže.
     *
     * Tvrdenie je napísané ako „jedno z dvoch" zámerne: čo presne libmagic
     * o krátkom úryvku povie, sa medzi verziami mení, ale vlastnosť, na ktorej
     * záleží, platí v oboch prípadoch. Test, ktorý by závisel od verzie
     * `file(1)`, by raz spadol zo zlého dôvodu.
     */
    public function test_script_files_never_keep_their_extension_on_disk(): void
    {
        $thread = $this->thread();

        foreach ([
            'utok.php' => "<?php echo shell_exec('id'); ?>\n",
            'utok.svg' => '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
            'utok.html' => "<html><body><script>alert(1)</script></body></html>\n",
        ] as $name => $content) {
            try {
                $attachment = $this->upload($thread, $name, $content);
            } catch (RuntimeException $e) {
                $this->assertStringContainsString('priložiť nedá', $e->getMessage());

                continue;
            }

            $this->assertMatchesRegularExpression(
                '/\.(txt|md|csv|json)$/',
                $attachment->path,
                "{$name} nesmie na disku zostať spustiteľnou príponou"
            );
            $this->assertStringStartsWith('text/', $attachment->mime);
        }
    }

    public function test_size_and_count_caps_refuse_the_upload(): void
    {
        config(['hades.console.attachments.max_bytes' => 32]);
        $thread = $this->thread();

        try {
            $this->upload($thread, 'velky.txt', str_repeat('a', 64));
            $this->fail('veľký súbor sa mal odmietnuť');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('väčší', $e->getMessage());
        }

        config(['hades.console.attachments.max_bytes' => 1024, 'hades.console.attachments.max_per_thread' => 1]);

        $this->upload($thread, 'prvy.txt', "jeden\n");

        try {
            $this->upload($thread, 'druhy.txt', "dva\n");
            $this->fail('druhá príloha sa mala odmietnuť stropom počtu');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('strop', $e->getMessage());
        }

        $this->assertSame(1, ConsoleAttachment::count());
    }

    /**
     * Ten istý obsah dvakrát: dva riadky, jeden súbor.
     *
     * Riadky sa nezdieľajú (každý má vlastné uuid a vlastný `message_id`), ale
     * súbor áno — to je ten istý vzťah, aký vznikne pri vetvení, keď editácia
     * správy skopíruje prílohy ako riadky s tou istou cestou.
     */
    public function test_identical_content_reuses_the_file(): void
    {
        $thread = $this->thread();

        $first = $this->upload($thread, 'a.txt', "to iste\n");
        $second = $this->upload($thread, 'b.txt', "to iste\n");

        $this->assertNotSame($first->uuid, $second->uuid);
        $this->assertSame($first->path, $second->path);
        $this->assertCount(1, glob($this->attachmentsRoot.'/'.$thread->uuid.'/*') ?: []);
    }

    public function test_pdf_text_is_extracted_on_the_server(): void
    {
        $thread = $this->thread();

        $attachment = $this->upload(
            $thread,
            'zmluva.pdf',
            $this->pdfBytes('Zmluva o dielo medzi dvoma stranami, cislo 42.')
        );

        $this->assertSame('application/pdf', $attachment->mime);
        $this->assertSame('ready', $attachment->textState());
        $this->assertStringContainsString('Zmluva o dielo', (string) $attachment->text_content);
    }

    /**
     * PDF bez čitateľného textu (skenované, alebo CID fonty bez CMap) skončí
     * v stave „bežalo, text nie je".
     *
     * `extracted_at` sa MUSÍ nastaviť aj tu: `null` znamená „extrakcia ešte
     * nebežala", a keby sa nechalo `null`, UI a fronta by čakali na výsledok,
     * ktorý už nikto nedodá.
     */
    public function test_pdf_without_readable_text_admits_it_instead_of_guessing(): void
    {
        $thread = $this->thread();

        $attachment = $this->upload(
            $thread,
            'sken.pdf',
            "%PDF-1.4\n4 0 obj\nstream\nBT <0041004200430044> Tj ET\nendstream\nendobj\n%%EOF\n"
        );

        $this->assertNotNull($attachment->extracted_at);
        $this->assertNull($attachment->text_content);
        $this->assertSame('no_text', $attachment->textState());
    }

    public function test_image_has_no_text_and_says_so(): void
    {
        $thread = $this->thread();
        $attachment = $this->upload($thread, 'logo.png', $this->pngBytes());

        $this->assertSame('image/png', $attachment->mime);
        $this->assertTrue($attachment->isImage());
        $this->assertSame('no_text', $attachment->textState());
    }

    // ---- 3. text do promptu ------------------------------------------------

    /**
     * Model dostane prílohu ako text so stropom — a každé skrátenie sa priznáva.
     * Vzor je `ContextBlock`: model, ktorý nevie, že mu niečo chýba, si to
     * domyslí a vydá to za obsah prílohy.
     */
    public function test_context_block_caps_the_number_of_files_and_admits_it(): void
    {
        config([
            'hades.console.attachments.context.files' => 2,
            'hades.console.attachments.context.chars' => 8000,
            'hades.console.attachments.context.file_chars' => 120,
        ]);

        $block = $this->attachments()->contextBlock($this->threeTextAttachments());

        $this->assertStringStartsWith('[prílohy — 2 súbory]', $block);
        $this->assertStringContainsString('… (prílohy skrátené: 2 z 3 súborov)', $block);
        $this->assertStringContainsString('… (text prílohy skrátený: 120 z 920 znakov)', $block);
        $this->assertStringContainsString('subor1.txt (text/plain', $block);
        $this->assertStringNotContainsString('subor3.txt', $block);
        $this->assertStringEndsWith('[/prílohy]', $block);
    }

    /**
     * Strop znakov je druhý, nezávislý — a je to strop CELÉHO bloku, nie súčtu
     * povolených súborov. Prvý súbor sa doňho vojde vždy: blok, ktorý by pri
     * jednej veľkej prílohe nepovedal modelu nič, by bol horší než skrátený.
     */
    public function test_context_block_caps_the_total_characters(): void
    {
        config([
            'hades.console.attachments.context.files' => 10,
            'hades.console.attachments.context.chars' => 250,
            'hades.console.attachments.context.file_chars' => 200,
        ]);

        $block = $this->attachments()->contextBlock($this->threeTextAttachments());

        $this->assertStringStartsWith('[prílohy — 1 súbor]', $block);
        $this->assertStringContainsString('… (prílohy skrátené: 1 z 3 súborov)', $block);
        $this->assertStringContainsString('subor1.txt', $block);
        $this->assertStringNotContainsString('subor2.txt', $block);
    }

    /** @return \Illuminate\Support\Collection<int, ConsoleAttachment> */
    private function threeTextAttachments()
    {
        $thread = $this->thread();

        return collect(range(1, 3))->map(fn (int $i) => ConsoleAttachment::create([
            'thread_id' => $thread->id,
            'original_name' => "subor{$i}.txt",
            'path' => $thread->uuid.'/'.$i.'.txt',
            'mime' => 'text/plain',
            'size_bytes' => 900,
            // 40 × 23 znakov = 920, teda spoľahlivo nad každým stropom nižšie.
            'text_content' => str_repeat('veta o obsahu prilohy. ', 40),
            'extracted_at' => now(),
        ]));
    }

    public function test_context_block_is_empty_without_attachments(): void
    {
        $this->assertSame('', $this->attachments()->contextBlock([]));
    }

    public function test_context_block_says_when_a_file_has_no_text(): void
    {
        $thread = $this->thread();
        $attachment = $this->upload($thread, 'logo.png', $this->pngBytes());

        $block = $this->attachments()->contextBlock([$attachment]);

        $this->assertStringContainsString('text sa v prílohe nenašiel', $block);
    }

    /**
     * Priradenie k správe sa hľadá VÝHRADNE vo vlákne správy. Uuid z cudzieho
     * vlákna by inak k správe pripojilo súbor, ktorý si tu nikto nepriložil —
     * to isté pravidlo, ako keď `decide()` hľadá tool call v rámci vlákna.
     */
    public function test_binding_ignores_attachments_of_another_thread(): void
    {
        $mine = $this->thread();
        $other = $this->thread();

        $ours = $this->upload($mine, 'ours.txt', "moje\n");
        $theirs = $this->upload($other, 'theirs.txt', "cudzie\n");

        $message = ConsoleMessage::create(['thread_id' => $mine->id, 'role' => 'user', 'content' => 'ahoj']);

        $bound = $this->attachments()->bind($mine, $message->id, [$ours->uuid, $theirs->uuid]);

        $this->assertSame(1, $bound);
        $this->assertSame($message->id, $ours->fresh()->message_id);
        $this->assertNull($theirs->fresh()->message_id);
    }

    /**
     * Dvojica, ktorú volá hranica behu: blok sa skládá z uuid na serveri
     * a priradenie sadne na poslednú správu človeka (vo vlákne beží jeden ťah
     * naraz). Cudzie ani už priradené prílohy sa do bloku nedostanú.
     */
    public function test_drafts_for_the_run_are_resolved_on_the_server(): void
    {
        $thread = $this->thread();
        $other = $this->thread();

        $draft = $this->upload($thread, 'draft.txt', "Obsah pre model.\n");
        $foreign = $this->upload($other, 'foreign.txt', "Cudzi obsah.\n");

        $resolved = $this->attachments()->draftsFor($thread, [$draft->uuid, $foreign->uuid, 'nie-je-uuid']);
        $this->assertSame([$draft->uuid], $resolved->pluck('uuid')->all());

        $block = $this->attachments()->contextBlock($resolved);
        $this->assertStringContainsString('Obsah pre model', $block);
        $this->assertStringNotContainsString('Cudzi obsah', $block);

        // Správu človeka zapisuje AgentRunner na začiatku ťahu, takže priradenie
        // sa robí až podľa nej.
        $message = ConsoleMessage::create(['thread_id' => $thread->id, 'role' => 'user', 'content' => 'ahoj']);

        $this->assertSame(1, $this->attachments()->bindDrafts($thread, [$draft->uuid, $foreign->uuid]));
        $this->assertSame($message->id, $draft->fresh()->message_id);
        $this->assertNull($foreign->fresh()->message_id);

        // Druhé zavolanie už nemá čo priradiť — príloha nie je rozpracovaná.
        $this->assertSame(0, $this->attachments()->bindDrafts($thread, [$draft->uuid]));
    }

    // ---- 4. mazanie a zametanie -------------------------------------------

    public function test_deleting_a_row_keeps_the_file_for_the_sweeper(): void
    {
        $thread = $this->thread();
        $attachment = $this->upload($thread, 'a.txt', "obsah\n");
        $absolute = $this->attachmentsRoot.'/'.$attachment->path;

        $attachment->delete();

        // Súbor prežije mazanie riadku zámerne: pri vetvení naň ukazuje viac
        // riadkov a mazanie „svojho" súboru by vytrhlo prílohu druhej vetvy.
        $this->assertFileExists($absolute);
    }

    public function test_deleting_a_thread_takes_its_directory(): void
    {
        $thread = $this->thread();
        $this->upload($thread, 'a.txt', "obsah\n");

        $directory = $this->attachmentsRoot.'/'.$thread->uuid;
        $this->assertDirectoryExists($directory);

        $this->attachments()->forgetThread($thread->uuid);

        $this->assertDirectoryDoesNotExist($directory);
    }

    public function test_sweeper_takes_stale_drafts_orphan_directories_and_rowless_files(): void
    {
        $thread = $this->thread();
        $message = ConsoleMessage::create(['thread_id' => $thread->id, 'role' => 'user', 'content' => 'ahoj']);

        $kept = $this->upload($thread, 'kept.txt', "patri k sprave\n");
        $kept->update(['message_id' => $message->id]);

        $draft = $this->upload($thread, 'draft.txt', "rozpracovane\n");
        // `created_at` nie je vo `fillable`, takže cez model by sa ticho
        // nezapísalo a test by meral iba to, že mladý draft prežil.
        ConsoleAttachment::query()->where('id', $draft->id)->update(['created_at' => now()->subHours(48)]);
        touch($this->attachmentsRoot.'/'.$draft->path, time() - 48 * 3600);

        // Súbor bez riadku: ťah spadol medzi presunom na disk a INSERTom.
        $rowless = $this->attachmentsRoot.'/'.$thread->uuid.'/'.Str::uuid().'.txt';
        File::put($rowless, "nikto na mna neukazuje\n");
        touch($rowless, time() - 48 * 3600);

        // Priečinok vlákna, ktoré už neexistuje.
        $orphan = $this->attachmentsRoot.'/'.Str::uuid();
        File::ensureDirectoryExists($orphan);
        File::put($orphan.'/x.txt', "osirele\n");

        $dry = $this->attachments()->sweep(6, true);
        $this->assertSame(1, $dry['drafts']);
        $this->assertSame(1, $dry['threads']);
        $this->assertFileExists($rowless, 'dry-run nesmie nič zmazať');

        $result = $this->attachments()->sweep(6);

        $this->assertSame(1, $result['drafts']);
        $this->assertSame(1, $result['threads']);
        $this->assertNull(ConsoleAttachment::find($draft->id));
        $this->assertFileDoesNotExist($rowless);
        $this->assertDirectoryDoesNotExist($orphan);

        // A to, čo patrí k odoslanej správe, zostalo nedotknuté.
        $this->assertNotNull(ConsoleAttachment::find($kept->id));
        $this->assertFileExists($this->attachmentsRoot.'/'.$kept->path);
    }

    /**
     * Súbor, ktorého riadok práve vzniká, sa zametačom nesmie zmazať — inak by
     * upload a zametanie v tej istej minúte skončili prílohou bez obsahu.
     */
    public function test_sweeper_leaves_a_fresh_rowless_file_alone(): void
    {
        $thread = $this->thread();
        $fresh = $this->attachmentsRoot.'/'.$thread->uuid.'/'.Str::uuid().'.txt';
        File::ensureDirectoryExists(dirname($fresh));
        File::put($fresh, "prave nahrany\n");

        $this->attachments()->sweep(6);

        $this->assertFileExists($fresh);
    }

    public function test_reap_command_runs(): void
    {
        $this->artisan('mind:reap-attachments --dry-run')->assertSuccessful();
        $this->artisan('mind:reap-attachments')->assertSuccessful();
    }

    // ---- hranica -----------------------------------------------------------

    public function test_endpoint_refuses_a_type_outside_the_whitelist(): void
    {
        $thread = $this->thread();
        $request = Request::create('/api/console/threads/'.$thread->uuid.'/attachments', 'POST', [], [], [
            'file' => $this->uploadedFile('utok.php', "<?php echo shell_exec('id');\n"),
        ]);

        try {
            app(AttachmentController::class)->store($request, $thread, $this->attachments());
            $this->fail('hranica mala typ mimo whitelistu odmietnuť');
        } catch (ValidationException $e) {
            $this->assertStringContainsString('priložiť nedá', $e->validator->errors()->first('file'));
        }

        $this->assertSame(0, ConsoleAttachment::count());
    }

    /**
     * Zoznam nenačítava `text_content` (longText), ale stav textu musí hlásiť ten
     * istý ako plný riadok. Keby optimalizácia stav zmenila, UI by o prílohe
     * s textom tvrdilo, že text nemá — lož, ktorá vznikla zo šetrenia pamäte.
     */
    public function test_listing_reports_the_same_text_state_as_the_full_row(): void
    {
        $thread = $this->thread();
        $withText = $this->upload($thread, 'text.txt', "Toto je obsah prilohy.\n");
        $withoutText = $this->upload($thread, 'logo.png', $this->pngBytes());

        $payload = app(AttachmentController::class)->index($thread)->getData(true);

        $states = collect($payload['attachments'])->pluck('text_state', 'uuid');

        $this->assertSame($withText->textState(), $states[$withText->uuid]);
        $this->assertSame($withoutText->textState(), $states[$withoutText->uuid]);
        $this->assertSame('ready', $states[$withText->uuid]);
        $this->assertSame('no_text', $states[$withoutText->uuid]);
    }

    /**
     * Odpoveď na stiahnutie nesmie dovoliť prehliadaču hádať typ. Bez `nosniff`
     * by nahraný textový súbor vedel bežať ako HTML na našom vlastnom origine —
     * a appka je verejne tunelovaná cez ngrok.
     */
    public function test_download_never_lets_the_browser_guess_the_type(): void
    {
        $thread = $this->thread();
        $text = $this->upload($thread, 'poznámky.txt', "obsah prilohy\n");
        $image = $this->upload($thread, 'logo.png', $this->pngBytes());

        $controller = app(AttachmentController::class);

        $textResponse = $controller->show($text, $this->attachments());
        $this->assertSame('nosniff', $textResponse->headers->get('X-Content-Type-Options'));
        $this->assertSame('text/plain', $textResponse->headers->get('Content-Type'));
        $this->assertStringStartsWith('attachment', (string) $textResponse->headers->get('Content-Disposition'));
        // `response()->file()` sama nastavuje `public`; obsah prílohy nesmie
        // skončiť v zdieľanej cache proxy (Caddy, ngrok).
        $this->assertStringContainsString('private', (string) $textResponse->headers->get('Cache-Control'));
        $this->assertStringNotContainsString('public', (string) $textResponse->headers->get('Cache-Control'));

        // Obrázok sa v chate zobrazuje, takže `inline` — a stále bez hádania typu.
        $imageResponse = $controller->show($image, $this->attachments());
        $this->assertSame('image/png', $imageResponse->headers->get('Content-Type'));
        $this->assertStringStartsWith('inline', (string) $imageResponse->headers->get('Content-Disposition'));
        $this->assertSame('nosniff', $imageResponse->headers->get('X-Content-Type-Options'));
    }

    /** História vlákna sa neprepisuje ani nemaže — ani jej prílohy. */
    public function test_endpoint_refuses_to_delete_an_attachment_of_a_sent_message(): void
    {
        $thread = $this->thread();
        $message = ConsoleMessage::create(['thread_id' => $thread->id, 'role' => 'user', 'content' => 'ahoj']);
        $attachment = $this->upload($thread, 'a.txt', "obsah\n");

        $controller = app(AttachmentController::class);

        $draftDeleted = $controller->destroy($attachment);
        $this->assertSame(200, $draftDeleted->getStatusCode());
        $this->assertNull(ConsoleAttachment::find($attachment->id));

        $bound = $this->upload($thread, 'b.txt', "iny obsah\n");
        $bound->update(['message_id' => $message->id]);

        $refused = $controller->destroy($bound);
        $this->assertSame(422, $refused->getStatusCode());
        $this->assertNotNull(ConsoleAttachment::find($bound->id));
    }
}
