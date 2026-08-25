<?php

namespace App\Services\Console;

use App\Models\ConsoleAttachment;
use App\Models\ConsoleMessage;
use App\Models\ConsoleThread;
use App\Services\Console\Tools\PathGuard;
use App\Services\Console\Tools\ToolRefusal;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Prílohy vlákna — uloženie na disk, cesta k obsahu, text do promptu, zametanie.
 *
 * ## Obsah na disk, metadáta do DB
 *
 * Blob v databáze by bol v každom `mysqldump` (záloha pred migráciou je povinná,
 * §5/11 kontraktu) a stiahnutie z blobu znamená celý súbor v pamäti jedného
 * z ôsmich PHP workerov. Preto `<koreň>/<thread-uuid>/<attachment-uuid>.<ext>`
 * a v riadku len metadáta.
 *
 * ## Appka je verejne tunelovaná cez ngrok, takže tu platí päť pravidiel
 *
 *  1. **Whitelist typov, nie blacklist.** Blacklist je zoznam toho, na čo si
 *     niekto stihol myslieť; whitelist je zoznam toho, čo appka naozaj vie
 *     zobraziť. Typ sa zisťuje NA SERVERI (`finfo` cez `UploadedFile`) —
 *     `Content-Type` od klienta je tvrdenie, nie fakt.
 *  2. **Meno na disku vyrába uuid**, nikdy `original_name`. Názov od človeka
 *     je jediný vstup, ktorý by sa do cesty inak dostal.
 *  3. **Prípona sa berie z povoleného typu**, nie z názvu súboru. `faktura.php`
 *     rozpoznaná ako `text/plain` skončí ako `<uuid>.txt`.
 *  4. **Nahraný súbor sa nikdy nespúšťa ani neinterpretuje.** Čítame z neho
 *     bajty (odtlačok, text), nič viac — žiadny `exec`, žiadny `include`,
 *     žiadny externý konvertor. Preto tu nie je ani `pdftotext`.
 *  5. **Stropy sú tri:** veľkosť jedného súboru, počet príloh na vlákno a strop
 *     textu, ktorý ide modelu do kontextu.
 *
 * ## Prečo tu je fail-closed kontrola `PathGuard`
 *
 * Default koreň príloh leží POD `hades.console.files_root` (ten je `base_path()`),
 * takže bez deny prefixu v {@see PathGuard} by si model vo vlákne A prečítal
 * `read_file`om prílohu vlákna B. Kontrola je preto v ceste ukládania:
 * {@see assertHiddenFromFileTools()} sa spýta guardu na koreň príloh a keď ho
 * guard NEODMIETNE, upload sa neuskutoční. Kým deny prefix nie je na mieste,
 * prílohy nikde neležia — to je celý zmysel slova fail-closed.
 *
 * ## Cesta z DB sa odmieta, nesanitizuje
 *
 * `path` v riadku je relatívny ku koreňu a pred čítaním sa rozloží (`realpath`).
 * Riadok, ktorého cesta vedie von — `../../.env`, symlink na `/etc` — sa
 * **odmietne**. To isté pravidlo ako v `PathGuard`, len s druhým, úzkym koreňom:
 * sanitizovaná cesta ticho prečíta niečo iné, než riadok sľubuje, a to je horšie
 * než chyba.
 */
class Attachments
{
    /**
     * Povolené typy → prípona na disku.
     *
     * Zámerne krátky zoznam. Čo v ňom NIE JE a prečo:
     *
     *  - `image/svg+xml` — SVG je dokument so skriptom, nie obrázok. Appka je
     *    verejne tunelovaná a náhľad prílohy beží na jej vlastnom origine.
     *  - archívy (`zip`, `gz`) — appka ich nemá čím otvoriť, takže by to bol
     *    priestor na disku bez čitateľa.
     *  - `text/html` — to isté ako SVG.
     *
     * Defaulty sú TU, nie iba v configu: `config/hades.php` píše iná koľaj tohto
     * šprintu a upload nemá čakať na cudzí súbor. Config ich prepíše, keď dorazí.
     *
     * @var array<string, string>
     */
    private const MIMES = [
        'text/plain' => 'txt',
        'text/markdown' => 'md',
        'text/csv' => 'csv',
        'application/json' => 'json',
        'application/pdf' => 'pdf',
        'image/png' => 'png',
        'image/jpeg' => 'jpg',
        'image/gif' => 'gif',
        'image/webp' => 'webp',
    ];

    /** 10 MB na súbor — PDF zo skenu má reálne jednotky MB, video sem nepatrí. */
    private const MAX_BYTES = 10 * 1024 * 1024;

    /** Strop príloh na vlákno. Nie je to ochrana disku, ale kontextu a UI. */
    private const MAX_PER_THREAD = 20;

    /** Strop uloženého vytiahnutého textu (znaky). */
    private const TEXT_CAP = 200000;

    /** Nad týmto sa text neťahá vôbec — parsovanie by zjedlo pamäť workera. */
    private const EXTRACT_MAX_BYTES = 8 * 1024 * 1024;

    /** Po koľkých hodinách je rozpracovaná príloha (`message_id IS NULL`) odpad. */
    private const DRAFT_HOURS = 6;

    /** Strop príloh a znakov, ktoré idú modelu do kontextu. */
    private const CTX_FILES = 4;

    private const CTX_CHARS = 4000;

    private const CTX_FILE_CHARS = 1500;

    public function __construct(private readonly PathGuard $guard) {}

    // ---- koreň -------------------------------------------------------------

    /**
     * Absolútny koreň príloh. Priečinok sa vyrobí, keď nie je — a až potom sa
     * overí, že ho súborové tooly nevidia.
     *
     * @throws RuntimeException
     */
    public function root(): string
    {
        $configured = trim((string) config(
            'hades.console.attachments_root',
            storage_path('app/console-attachments')
        ));

        if ($configured === '') {
            throw new RuntimeException('Koreň príloh nie je nastavený — prílohy sa neukladajú.');
        }

        $normalized = rtrim(str_replace('\\', '/', $configured), '/');

        if (! is_dir($normalized) && ! @mkdir($normalized, 0775, true) && ! is_dir($normalized)) {
            throw new RuntimeException('Priečinok príloh sa nepodarilo vyrobiť — prílohy sa neukladajú.');
        }

        $real = realpath($normalized);

        if ($real === false) {
            throw new RuntimeException('Priečinok príloh sa nepodarilo nájsť — prílohy sa neukladajú.');
        }

        return rtrim(str_replace('\\', '/', $real), '/');
    }

    /**
     * Fail-closed: keď `PathGuard` koreň príloh NEODMIETNE, neukladá sa nič.
     *
     * Sonda ide cez `searchScope()` a nie cez `file()` zámerne: `file()` odmietne
     * aj neexistujúci súbor („File does not exist"), takže by prešla každá
     * konfigurácia a kontrola by nemerala nič — presne ten druh harnessu, ktorý
     * je zelený a nehovorí o ničom. Koreň v tomto bode existuje, takže odmietnuť
     * ho `searchScope()` môže z troch dôvodov a všetky tri sú v poriadku: deny
     * prefix, poloha mimo `files_root`, alebo nefunkčný `files_root` (vtedy
     * súborové tooly nečítajú nič).
     *
     * Kontrola je poistka, nie vetva chovania: `PathGuard::deniedPrefixes()`
     * dnes zakáže každý koreň pod `files_root` (vrátane presunutého a takého,
     * ktorý je za symlinkom), takže žiadna KONFIGURÁCIA ju nespustí. Spustí ju
     * zmena KÓDU — vypadnutý deny prefix — a to je presne to, čo má chytiť.
     * Preto sa sem nedá napísať test, ktorý ju vyvolá; testuje sa dôsledok,
     * teda že súborové tooly koreň príloh odmietajú.
     *
     * @throws RuntimeException
     */
    private function assertHiddenFromFileTools(string $root): void
    {
        try {
            $this->guard->searchScope($root);
        } catch (ToolRefusal) {
            return; // Guard prílohy nevidí. Presne tak to má byť.
        }

        throw new RuntimeException(
            'Koreň príloh je čitateľný pre súborové tooly modelu — prílohy sa neukladajú, '
            .'kým do PathGuard::DENY_PREFIXES nepribudne.'
        );
    }

    // ---- uloženie ----------------------------------------------------------

    /**
     * Uloží nahraný súbor a vráti jeho riadok. Rozpracovaná príloha
     * (`message_id = null`) sa k správe priradí až pri odoslaní ({@see bind()}).
     *
     * Text sa ťahá hneď, synchronne: je to jednotky až stovky milisekúnd, kým
     * inferencia na CPU stojí minúty, a fronta by k tomu pridala stav
     * „príloha existuje, ale ešte nemá text" v okamihu, keď človek odosiela
     * správu.
     *
     * @throws RuntimeException  s vetou pre človeka (422 na hranici)
     */
    public function store(ConsoleThread $thread, UploadedFile $file): ConsoleAttachment
    {
        if (! $file->isValid()) {
            throw new RuntimeException('Nahrávanie sa nedokončilo. Skús súbor priložiť znova.');
        }

        $limit = $this->intConfig('max_bytes', self::MAX_BYTES);
        $size = (int) $file->getSize();

        if ($size <= 0) {
            throw new RuntimeException('Súbor je prázdny — nie je čo priložiť.');
        }

        if ($size > $limit) {
            throw new RuntimeException(
                'Súbor je väčší než '.$this->humanBytes($limit).'. Priloženie sa nedá dokončiť.'
            );
        }

        // Typ ZISTENÝ na serveri. `getMimeType()` číta obsah dočasného súboru
        // (finfo), `getClientMimeType()` by prevzalo tvrdenie prehliadača.
        $mime = strtolower((string) $file->getMimeType());
        $mimes = $this->mimes();

        if (! isset($mimes[$mime])) {
            throw new RuntimeException(
                'Tento typ súboru sa priložiť nedá (zistený typ: '.($mime === '' ? 'neznámy' : $mime).'). '
                .'Prijímajú sa obrázky, PDF a textové súbory.'
            );
        }

        $perThread = $this->intConfig('max_per_thread', self::MAX_PER_THREAD);
        $count = ConsoleAttachment::query()->where('thread_id', $thread->id)->count();

        if ($count >= $perThread) {
            throw new RuntimeException(
                'Vlákno už má '.$perThread.' príloh — to je strop. Niektorú najprv odober.'
            );
        }

        $root = $this->root();
        $this->assertHiddenFromFileTools($root);

        // Priečinok vlákna sa skladá z jeho uuid. Overuje sa aj tak: cesta sa
        // v tejto appke neskládá zo žiadnej hodnoty, ktorej tvar nikto nepozrel.
        $threadUuid = (string) $thread->uuid;

        if (preg_match('/^[0-9a-fA-F-]{36}$/', $threadUuid) !== 1) {
            throw new RuntimeException('Vlákno nemá platný identifikátor — príloha sa nedá uložiť.');
        }

        $sha = hash_file('sha256', (string) $file->getRealPath());
        $sha = $sha === false ? null : $sha;

        $uuid = (string) Str::uuid();
        $relative = $threadUuid.'/'.$uuid.'.'.$mimes[$mime];

        // Deduplikácia je v rámci VLÁKNA: ten istý súbor v dvoch vláknach sú dva
        // súbory, pretože priečinok vlákna sa maže ako celok (a s ním by zmizol
        // obsah cudzieho vlákna). V rámci vlákna sa riadok pridá, súbor nie —
        // to je ten istý vzťah ako pri vetvení, kde dve vetvy zdieľajú jeden súbor.
        $twin = $sha === null ? null : ConsoleAttachment::query()
            ->where('thread_id', $thread->id)
            ->where('sha256', $sha)
            ->orderBy('id')
            ->first();

        if ($twin !== null && is_file($root.'/'.$twin->path)) {
            $relative = (string) $twin->path;
        } else {
            $absolute = $this->assertInsideRoot($root.'/'.$relative, $root);
            $directory = dirname($absolute);

            if (! is_dir($directory) && ! @mkdir($directory, 0775, true) && ! is_dir($directory)) {
                throw new RuntimeException('Priečinok vlákna sa nepodarilo vyrobiť — príloha sa neuložila.');
            }

            $file->move($directory, basename($absolute));
        }

        $attachment = ConsoleAttachment::create([
            'uuid' => $uuid,
            'thread_id' => $thread->id,
            'message_id' => null,
            // Názov od človeka je jediný vstup, ktorý sa tu ukladá tak, ako
            // prišiel. Do cesty sa nedostane a v odpovedi ide ako JSON string,
            // takže `../` v ňom je text, nie cesta.
            'original_name' => $this->safeName($file->getClientOriginalName()),
            'path' => $relative,
            'mime' => $mime,
            'size_bytes' => $size,
            'sha256' => $sha,
        ]);

        return $this->extract($attachment);
    }

    /**
     * Priradí rozpracované prílohy k odoslanej správe.
     *
     * Hľadá sa VÝHRADNE vo vlákne, do ktorého správa patrí — uuid z cudzieho
     * vlákna by inak k správe pripojilo súbor, ktorý si v tomto vlákne nikto
     * nepriložil. Je to to isté rozhodnutie ako v `RunController::decide()`,
     * kde sa tool call hľadá v rámci vlákna.
     *
     * @param  array<int, string>  $uuids
     * @return int  koľko príloh sa priradilo
     */
    public function bind(ConsoleThread $thread, int $messageId, array $uuids): int
    {
        $uuids = array_values(array_filter(array_map('strval', $uuids), fn ($u) => $u !== ''));

        if ($uuids === []) {
            return 0;
        }

        return ConsoleAttachment::query()
            ->where('thread_id', $thread->id)
            ->whereNull('message_id')
            ->whereIn('uuid', $uuids)
            ->update(['message_id' => $messageId]);
    }

    /**
     * To isté, ale k POSLEDNEJ správe človeka vo vlákne.
     *
     * Existuje preto, aby hranica behu (`RunController`) nemusela vedieť, ktorá
     * správa je „tá jej": správu človeka zapisuje `AgentRunner` na začiatku ťahu,
     * takže id vzniká až vnútri behu.
     *
     * Prečo je „posledná správa človeka" tá správna: **vo vlákne beží jeden ťah
     * naraz** — `RunRecorder::openExclusive()` zamyká riadok vlákna a
     * `RunController::run()` odmietne správu, kým čaká nedorozhodnutý zápis. Je
     * to tá istá podmienka, na ktorej stojí rozsah id v `runs`; keby ju niekto
     * „optimalizoval" na súbežné ťahy, prílohy by sadli na cudziu správu presne
     * tak, ako by rozsah behu hlásil cenu cudzieho ťahu.
     *
     * @param  array<int, string>  $uuids
     */
    public function bindDrafts(ConsoleThread $thread, array $uuids): int
    {
        if ($uuids === []) {
            return 0;
        }

        $messageId = ConsoleMessage::query()
            ->where('thread_id', $thread->id)
            ->where('role', 'user')
            ->max('id');

        return $messageId === null ? 0 : $this->bind($thread, (int) $messageId, $uuids);
    }

    /**
     * Rozpracované prílohy vlákna podľa uuid, v poradí vzniku.
     *
     * Hranica behu posiela iba uuid a blok kontextu sa skládá TU, na serveri —
     * to isté pravidlo ako v {@see ContextBlock}: keby text prílohy skládal
     * klient, dal by sa modelu (ktorý má zápisové tooly) podstrčiť súbor, ktorý
     * nikto nenahral.
     *
     * @param  array<int, string>  $uuids
     * @return \Illuminate\Database\Eloquent\Collection<int, ConsoleAttachment>
     */
    public function draftsFor(ConsoleThread $thread, array $uuids): EloquentCollection
    {
        $uuids = array_values(array_filter(array_map('strval', $uuids), fn ($u) => $u !== ''));

        if ($uuids === []) {
            return new EloquentCollection();
        }

        return ConsoleAttachment::query()
            ->where('thread_id', $thread->id)
            ->whereNull('message_id')
            ->whereIn('uuid', $uuids)
            ->orderBy('id')
            ->get();
    }

    // ---- cesta k obsahu ----------------------------------------------------

    /**
     * Absolútna cesta k obsahu prílohy — alebo výnimka.
     *
     * Toto je jediné miesto, kde sa z riadku stáva cesta na disku, a preto tu
     * platí pravidlo `PathGuard`u: rozloží sa (`realpath`) a musí padnúť do
     * koreňa príloh. Kontrola je dvojitá zámerne — lexikálna zachytí `..`
     * v riadku ešte pred dotykom disku, `realpath` zachytí symlink, ktorý sa
     * do zápisu cesty napísať nedá.
     *
     * @throws RuntimeException
     */
    public function absolutePath(ConsoleAttachment $attachment): string
    {
        $root = $this->root();
        $relative = trim(str_replace('\\', '/', (string) $attachment->path));

        if ($relative === '') {
            throw new RuntimeException('Príloha nemá cestu k obsahu.');
        }

        if (str_starts_with($relative, '/') || preg_match('#^[A-Za-z]:/#', $relative) === 1) {
            // Absolútna cesta v riadku sa neprepočítava na relatívnu: nedá sa
            // rozhodnúť, či mieri do koreňa alebo len tak vyzerá.
            throw new RuntimeException('Cesta prílohy je odmietnutá: musí byť relatívna ku koreňu príloh.');
        }

        $this->assertInsideRoot($root.'/'.$relative, $root);

        $real = realpath($root.'/'.$relative);

        if ($real === false) {
            throw new RuntimeException('Obsah prílohy na disku nie je.');
        }

        return $this->assertInsideRoot($real, $root);
    }

    // ---- text do promptu ---------------------------------------------------

    /**
     * Blok príloh pre model — TEXT, nikdy surový súbor.
     *
     * Vzor je {@see ContextBlock}: pevný strop, priznané skrátenie, žiadny
     * obsah skladaný v prehliadači. Model, ktorý nevie, že mu niečo chýba, si
     * to domyslí — preto sa každé skrátenie hovorí nahlas, a to na dvoch
     * úrovniach: text jedného súboru aj počet súborov.
     *
     * Obrázok text nemá; v bloku je aj tak, aby model vedel, že ho človek
     * priložil, a nehovoril o „žiadnej prílohe".
     *
     * @param  iterable<ConsoleAttachment>  $attachments
     */
    public function contextBlock(iterable $attachments): string
    {
        $maxFiles = $this->intConfig('context.files', self::CTX_FILES);
        $budget = $this->intConfig('context.chars', self::CTX_CHARS);
        $perFile = $this->intConfig('context.file_chars', self::CTX_FILE_CHARS);

        $all = [];
        foreach ($attachments as $attachment) {
            $all[] = $attachment;
        }

        $requested = count($all);

        if ($requested === 0) {
            return '';
        }

        $parts = [];
        $used = 0;
        $included = 0;

        foreach (array_slice($all, 0, $maxFiles) as $attachment) {
            $head = '### '.$attachment->original_name
                .' ('.$attachment->mime.', '.$this->humanBytes((int) $attachment->size_bytes).')';

            $text = (string) ($attachment->text_content ?? '');
            $chunk = $head;

            if ($text === '') {
                $chunk .= $attachment->extracted_at === null
                    ? ' — text sa z prílohy ešte nečítal'
                    : ' — text sa v prílohe nenašiel';
            } else {
                $full = mb_strlen($text);
                $cut = mb_substr($text, 0, $perFile);
                $chunk .= "\n".$cut;

                if ($full > $perFile) {
                    $chunk .= "\n… (text prílohy skrátený: ".$perFile.' z '.$full.' znakov)';
                }
            }

            $length = mb_strlen($chunk) + 1; // +1 za spájací \n

            if ($included > 0 && $used + $length > $budget) {
                break; // Strop znakov; koľko sa nezmestilo, prizná hlavička.
            }

            $parts[] = $chunk;
            $used += $length;
            $included++;
        }

        if ($included === 0) {
            return '';
        }

        $header = '[prílohy — '.$included.' '.$this->pluralFiles($included).']';

        if ($included < $requested) {
            $header .= "\n… (prílohy skrátené: ".$included.' z '.$requested.' súborov)';
        }

        return $header."\n".implode("\n", $parts)."\n[/prílohy]";
    }

    /**
     * Vytiahne text a zapíše ho do riadku.
     *
     * `extracted_at` sa nastavuje VŽDY, keď extrakcia zbehla — aj keď text
     * nevyšiel. Dvojstavovosť je celý zmysel tých dvoch stĺpcov: `null`
     * znamená „ešte nebežala" a keby sa nechalo `null` po neúspechu, fronta aj
     * UI by čakali na výsledok, ktorý už nikto nedodá.
     */
    public function extract(ConsoleAttachment $attachment): ConsoleAttachment
    {
        $attachment->text_content = $this->textOf($attachment);
        $attachment->extracted_at = Carbon::now();
        $attachment->save();

        return $attachment;
    }

    /** Vytiahnutý text, alebo `null` keď v súbore text nie je. */
    private function textOf(ConsoleAttachment $attachment): ?string
    {
        if ((int) $attachment->size_bytes > $this->intConfig('extract_max_bytes', self::EXTRACT_MAX_BYTES)) {
            return null;
        }

        try {
            $absolute = $this->absolutePath($attachment);
        } catch (RuntimeException) {
            // Chýbajúci alebo odmietnutý obsah nie je dôvod zhodiť upload; stav
            // „bežalo, text nie je" je čitateľný a UI ho vie povedať.
            return null;
        }

        $binary = @file_get_contents($absolute);

        if ($binary === false || $binary === '') {
            return null;
        }

        $text = $attachment->isPdf()
            ? $this->pdfText($binary)
            : $this->plainText($attachment->mime, $binary);

        if ($text === null) {
            return null;
        }

        $text = trim(preg_replace('/[ \t]+\n/', "\n", preg_replace('/\n{3,}/', "\n\n", $text) ?? '') ?? '');

        if ($text === '') {
            return null;
        }

        return mb_substr($text, 0, $this->intConfig('text_cap', self::TEXT_CAP));
    }

    /** Textový súbor: obsah tak, ako je — len keď je to naozaj text v UTF-8. */
    private function plainText(string $mime, string $binary): ?string
    {
        if (! str_starts_with($mime, 'text/') && $mime !== 'application/json') {
            return null; // Obrázok. Text v ňom nie je a OCR tu nie je v rozsahu.
        }

        if (str_contains($binary, "\0")) {
            return null; // Binárka vydávaná za text.
        }

        return mb_check_encoding($binary, 'UTF-8') ? $binary : null;
    }

    /**
     * PDF → text bez toho, aby sa čokoľvek spúšťalo.
     *
     * Poradie je: knižnica, keď je v projekte; inak vlastný minimálny čítač
     * obsahových streamov. Externý konvertor (`pdftotext`) tu NIE JE zámerne —
     * bolo by to spustenie procesu nad súborom, ktorý poslal niekto cudzí,
     * v appke tunelovanej cez ngrok.
     *
     * Minimálny čítač rozumie tomu, čo sa dá prečítať bez implementovania PDF:
     * `FlateDecode` (`gzuncompress`, zlib má PHP zabudované) alebo nekomprimovaný
     * stream, a v ňom literálne stringy pred operátormi kreslenia textu.
     * Nerozumie hex stringom (`<...>`) ani CID fontom s vlastnou CMap — tam
     * jeden bajt neznamená jeden znak a bez tabuľky fontu by vyšla kaša.
     *
     * Preto je na konci **brána kvality**: keď výsledok nevyzerá ako text,
     * vráti sa `null` a stav je „bežalo, text nie je". Domnelý text, ktorý je
     * v skutočnosti kaša, by šiel modelu do promptu ako fakt — a to je horšie
     * než príloha bez textu.
     */
    private function pdfText(string $binary): ?string
    {
        $parser = 'Smalot\\PdfParser\\Parser';

        if (class_exists($parser)) {
            try {
                /** @var object{parseContent: callable} $instance */
                $instance = new $parser();
                $text = (string) $instance->parseContent($binary)->getText();

                if (trim($text) !== '') {
                    return $text;
                }
            } catch (\Throwable) {
                // Knižnica na tomto súbore zlyhala — skúsi sa vlastný čítač.
            }
        }

        $out = '';

        // `stream` … `endstream` je jediná časť PDF, v ktorej text býva. Hlavičky
        // objektov sa preskakujú, pretože na rozhodnutie „je toto text?" nie sú
        // potrebné.
        if (preg_match_all('/stream\r?\n?(.*?)endstream/s', $binary, $matches) !== false) {
            foreach ($matches[1] ?? [] as $stream) {
                $decoded = @gzuncompress($stream);

                if ($decoded === false) {
                    $decoded = @gzinflate($stream);
                }

                if ($decoded === false) {
                    $decoded = $stream; // Nekomprimovaný obsahový stream.
                }

                if (! is_string($decoded) || $decoded === '') {
                    continue;
                }

                // Iba OBSAHOVÉ streamy. Bez tejto podmienky sa čítajú aj streamy
                // obrázkov a fontov, v ktorých sa `(` vyskytne náhodne — a ich
                // kaša potom stlačí bránu kvality pod prah, takže by sa zahodila
                // aj skutočne prečítaná stránka.
                if (preg_match('/\bBT\b|\bTj\b|\bTJ\b/', $decoded) !== 1) {
                    continue;
                }

                $out .= $this->pdfStreamText($decoded);
            }
        }

        // Literálne stringy v PDF sú bez zabudovanej CMap najčastejšie
        // WinAnsiEncoding, teda CP1252 — takže slovenská diakritika prichádza ako
        // jednotlivé bajty nad 0x7F. Bez tohto prekódovania by `looksLikeText()`
        // zahodilo každý slovenský dokument (regex s `/u` nad neplatným UTF-8
        // vracia `false`), a stĺpec `text_content` v utf8mb4 by aj tak neplatné
        // bajty neprijal.
        if (! mb_check_encoding($out, 'UTF-8')) {
            $converted = @mb_convert_encoding($out, 'UTF-8', 'Windows-1252');

            if (is_string($converted) && mb_check_encoding($converted, 'UTF-8')) {
                $out = $converted;
            }
        }

        return $this->looksLikeText($out) ? $out : null;
    }

    /**
     * Literálne stringy jedného obsahového streamu.
     *
     * Zlomy riadkov sa berú z operátorov posunu textu (`Td`, `TD`, `T*`, `ET`) —
     * bez nich by z odstavcov vyšla jedna dlhá veta a model by citoval riadky,
     * ktoré v dokumente nie sú.
     */
    private function pdfStreamText(string $stream): string
    {
        $out = '';
        $length = strlen($stream);

        for ($i = 0; $i < $length; $i++) {
            $char = $stream[$i];

            if ($char === '(') {
                $depth = 1;
                $i++;

                for (; $i < $length; $i++) {
                    $c = $stream[$i];

                    if ($c === '\\' && $i + 1 < $length) {
                        $next = $stream[$i + 1];
                        $out .= match ($next) {
                            'n' => "\n",
                            'r' => "\r",
                            't' => "\t",
                            'b', 'f' => ' ',
                            default => $next,
                        };
                        $i++;

                        continue;
                    }

                    if ($c === '(') {
                        $depth++;
                    } elseif ($c === ')') {
                        $depth--;

                        if ($depth === 0) {
                            break;
                        }
                    }

                    $out .= $c;
                }

                continue;
            }

            // `Td` / `TD` / `T*` / `ET` = nový riadok textu.
            if ($char === 'T' && $i + 1 < $length && in_array($stream[$i + 1], ['d', 'D', '*'], true)) {
                $out .= "\n";
                $i++;

                continue;
            }

            if ($char === 'E' && $i + 1 < $length && $stream[$i + 1] === 'T') {
                $out .= "\n";
                $i++;
            }
        }

        return $out;
    }

    /**
     * Brána kvality: vyzerá to ako text pre človeka?
     *
     * Meria sa podiel znakov, ktoré do bežného textu patria (písmená, čísla,
     * medzery, interpunkcia). PDF s CID fontom dá bajty, ktoré sú z väčšiny
     * mimo tejto množiny — a práve to je prípad, kedy je lepšie nemať text než
     * mať kašu.
     */
    private function looksLikeText(string $candidate): bool
    {
        $trimmed = trim($candidate);

        if (mb_strlen($trimmed) < 24) {
            return false;
        }

        $readable = preg_match_all('/[\p{L}\p{N}\s.,;:!?()\[\]\/\'"%+\-–—@#&*=<>]/u', $trimmed);
        $total = mb_strlen($trimmed);

        return $total > 0 && ($readable / $total) >= 0.85;
    }

    // ---- mazanie a zametanie ----------------------------------------------

    /**
     * Zmaže priečinok vlákna. Odvodí sa z uuid, takže netreba prečítať ani
     * jeden riadok — a práve preto to funguje aj po kaskádovom zmazaní riadkov.
     *
     * @return int  koľko súborov zmizlo
     */
    public function forgetThread(string $threadUuid): int
    {
        if (preg_match('/^[0-9a-fA-F-]{36}$/', $threadUuid) !== 1) {
            return 0;
        }

        $root = $this->root();
        $directory = realpath($root.'/'.$threadUuid);

        if ($directory === false) {
            return 0;
        }

        return $this->removeDirectory($this->assertInsideRoot($directory, $root));
    }

    /**
     * Zametač: rozpracované prílohy staršie než `$hours`, súbory, na ktoré
     * neukazuje žiadny riadok, a priečinky zmazaných vlákien.
     *
     * **Súbor sa nikdy nemaže pri mazaní riadku, len tu, a len keď naň neukazuje
     * žiadny riadok.** Dôvod je vetvenie: editácia správy skopíruje prílohy ako
     * RIADKY (nové uuid, ten istý `path`), takže mazanie súboru pri mazaní riadku
     * by zmazaním jednej vetvy vytrhlo prílohu druhej.
     *
     * Vek sa pri súboroch meria od `mtime` a s tým istým stropom ako
     * rozpracované prílohy. Bez toho by zametač trafil súbor, ktorý je práve
     * presunutý na disk, a riadok k nemu vznikne o milisekundu neskôr.
     *
     * @return array{drafts: int, files: int, threads: int}
     */
    public function sweep(int $hours, bool $dryRun = false): array
    {
        $hours = max($hours, 1);
        $cutoff = Carbon::now()->subHours($hours);
        $root = $this->root();

        $drafts = ConsoleAttachment::query()
            ->whereNull('message_id')
            ->where('created_at', '<', $cutoff)
            ->get(['id', 'uuid', 'path']);

        if (! $dryRun && $drafts->isNotEmpty()) {
            ConsoleAttachment::query()->whereIn('id', $drafts->pluck('id'))->delete();
        }

        // Živé cesty sa čítajú PO zmazaní rozpracovaných: inak by si zametač
        // sám držal súbory, ktorých riadky práve zahodil.
        $alive = $dryRun
            ? ConsoleAttachment::query()
                ->whereNotIn('id', $drafts->pluck('id'))
                ->pluck('path')
            : ConsoleAttachment::query()->pluck('path');

        $alivePaths = array_fill_keys($alive->map(fn ($p) => str_replace('\\', '/', (string) $p))->all(), true);
        $threadUuids = array_fill_keys(ConsoleThread::query()->pluck('uuid')->all(), true);

        $removedFiles = 0;
        $removedThreads = 0;

        foreach ((array) glob($root.'/*', GLOB_ONLYDIR) as $directory) {
            $directory = str_replace('\\', '/', (string) $directory);
            $uuid = basename($directory);

            if (! isset($threadUuids[$uuid])) {
                // Vlákno neexistuje — priečinok je osirelý celý.
                $removedThreads++;
                $removedFiles += $dryRun ? $this->countFiles($directory) : $this->removeDirectory($directory);

                continue;
            }

            foreach ((array) glob($directory.'/*') as $file) {
                $file = str_replace('\\', '/', (string) $file);

                if (! is_file($file)) {
                    continue;
                }

                $relative = $uuid.'/'.basename($file);

                if (isset($alivePaths[$relative])) {
                    continue;
                }

                if (filemtime($file) >= $cutoff->getTimestamp()) {
                    continue; // Môže to byť práve nahrávaný súbor.
                }

                $removedFiles++;

                if (! $dryRun) {
                    @unlink($file);
                }
            }
        }

        return [
            'drafts' => $drafts->count(),
            'files' => $removedFiles,
            'threads' => $removedThreads,
        ];
    }

    // ---- drobnosti ---------------------------------------------------------

    /**
     * Cesta musí padnúť do koreňa príloh. Odmietame, nesanitizujeme — to isté
     * pravidlo ako v `PathGuard`, len s druhým, úzkym koreňom.
     *
     * Segmenty `.` a `..` sa skladajú lexikálne, pretože kontrolovať treba aj
     * cestu k súboru, ktorý ešte neexistuje (nový upload).
     *
     * @throws RuntimeException
     */
    private function assertInsideRoot(string $candidate, string $root): string
    {
        $path = rtrim(str_replace('\\', '/', $candidate), '/');
        $segments = [];

        foreach (explode('/', $path) as $segment) {
            if ($segment === '.') {
                continue;
            }

            if ($segment === '..') {
                array_pop($segments);

                continue;
            }

            $segments[] = $segment;
        }

        $resolved = implode('/', $segments);

        if ($resolved !== $root && ! str_starts_with($resolved, $root.'/')) {
            // Zámerne bez cieľovej cesty v texte — nemá čo robiť v odpovedi ani
            // v logu, tak ako ju tam nedáva `PathGuard`.
            throw new RuntimeException('Cesta prílohy je odmietnutá: vedie mimo priečinka príloh.');
        }

        return $resolved;
    }

    /** @return int  koľko súborov sa zmazalo */
    private function removeDirectory(string $directory): int
    {
        $removed = 0;

        foreach ((array) glob($directory.'/*') as $entry) {
            $entry = (string) $entry;

            if (is_dir($entry)) {
                $removed += $this->removeDirectory($entry);

                continue;
            }

            if (@unlink($entry)) {
                $removed++;
            }
        }

        @rmdir($directory);

        return $removed;
    }

    private function countFiles(string $directory): int
    {
        $count = 0;

        foreach ((array) glob($directory.'/*') as $entry) {
            $count += is_dir((string) $entry) ? $this->countFiles((string) $entry) : 1;
        }

        return $count;
    }

    /** @return array<string, string> */
    private function mimes(): array
    {
        $configured = config('hades.console.attachments.mimes');

        return is_array($configured) && $configured !== [] ? $configured : self::MIMES;
    }

    private function intConfig(string $key, int $fallback): int
    {
        $value = config('hades.console.attachments.'.$key);

        return is_numeric($value) && (int) $value > 0 ? (int) $value : $fallback;
    }

    /** Ako dlho žije rozpracovaná príloha, kým ju zametač zmaže. */
    public function draftHours(): int
    {
        return $this->intConfig('draft_hours', self::DRAFT_HOURS);
    }

    /** Strop na jeden súbor — hranica ho potrebuje na validáciu aj na hlášku. */
    public function maxBytes(): int
    {
        return $this->intConfig('max_bytes', self::MAX_BYTES);
    }

    /** Povolené typy — hranica ich dáva do `mimetypes:` pravidla. */
    public function allowedMimes(): array
    {
        return array_keys($this->mimes());
    }

    /**
     * Meno na zobrazenie. Cesta sa z neho neskládá nikdy, takže tu nejde
     * o bezpečnosť cesty, ale o to, aby sa do UI nedostal riadiaci znak alebo
     * 4 kB dlhý názov.
     */
    private function safeName(?string $name): string
    {
        $clean = trim(preg_replace('/[\x00-\x1F\x7F]+/u', '', (string) $name) ?? '');
        $clean = basename(str_replace('\\', '/', $clean));

        return $clean === '' ? 'príloha' : mb_substr($clean, 0, 200);
    }

    private function humanBytes(int $bytes): string
    {
        if ($bytes >= 1024 * 1024) {
            return round($bytes / (1024 * 1024), 1).' MB';
        }

        return max(1, (int) round($bytes / 1024)).' kB';
    }

    /** Slovenský plurál pre „súbor". */
    private function pluralFiles(int $n): string
    {
        if ($n === 1) {
            return 'súbor';
        }

        return $n >= 2 && $n <= 4 ? 'súbory' : 'súborov';
    }
}
