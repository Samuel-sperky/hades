<?php

namespace App\Services\Console\Tools;

/**
 * Jediná cesta, ktorou sa súborové tooly dostanú k absolútnej ceste.
 *
 * Celá bezpečnosť konzoly stojí tu. Model dostane od používateľa vetu a z nej
 * poskladá `path` — takže `path` je vstup od cudzieho, nie parameter od
 * programátora, a platí pre neho to isté ako pre HTTP request.
 *
 * Tri rozhodnutia, ktoré sa nesmú zmeniť:
 *
 *  1. **Odmietame, nesanitizujeme.** Sanitizovaná cesta ticho zapíše niekam
 *     inam, než model chcel, a to je horšie než chyba: model si myslí, že
 *     upravil `config/app.php`, a upravil `app.php` v koreni. Odmietnutie vidí
 *     model aj človek.
 *  2. **Rozhoduje `realpath`, teda CIEĽ, nie zápis cesty.** `..` sa dá napísať
 *     desiatimi spôsobmi a symlink sa nedá napísať vôbec — `foo/link/x` vyzerá
 *     nevinne a môže mieriť na `/etc`. Preto sa každá cesta najprv rozloží na
 *     skutočnú a až potom sa kontroluje.
 *  3. **Neexistujúci súbor kontrolujeme cez RODIČA.** `realpath` na neexistujúci
 *     súbor vracia `false`, takže bez tejto vetvy by `write_file` na nový súbor
 *     buď vždy padol, alebo — horšie — obišiel kontrolu.
 *
 * Zakázané cesty (čítanie AJ zápis): všetko, čoho ktorýkoľvek segment začína
 * bodkou (`.env`, `.git/**`, `.ssh`), `vendor/**`, `node_modules/**` a
 * `storage/framework/**`. Konzola je za guardom presne preto, aby sa k tajomstvám
 * nedalo dostať — nesmie byť sama cestou, ako ich z tej škatule vytiahnuť.
 */
final class PathGuard
{
    /**
     * Celé segmenty, ktoré cesta nesmie obsahovať. `.env` a `.git` už pokrýva
     * pravidlo o bodke — sú tu menovite zámerne, aby bolo v kóde vidieť, že sú
     * zakázané, a aby ich zmazanie pravidla o bodke neodkrylo mlčky.
     */
    private const DENY_SEGMENTS = ['.env', '.git', 'vendor', 'node_modules'];

    /**
     * Zakázané prefixy relatívnej cesty (dvojsegmentové — `storage/app` je
     * legitímny obsah, `storage/framework` je session, cache a skompilované
     * view, teda vnútro appky).
     */
    private const DENY_PREFIXES = ['storage/framework'];

    /** Koreň, z ktorého sa smie čítať a doňho zapisovať (rozložený `realpath`). */
    public function root(): string
    {
        $configured = (string) config('hades.console.files_root', base_path());
        $root = realpath($configured);

        if ($root === false) {
            // Fail-closed: nenastavený alebo pokazený koreň neznamená „celý disk",
            // znamená „žiadne súbory".
            throw new ToolRefusal('Files root is not configured correctly — file tools are unavailable.');
        }

        return $this->normalize($root);
    }

    /**
     * Existujúci súbor na čítanie/úpravu.
     *
     * @throws ToolRefusal
     */
    public function file(string $path): string
    {
        $resolved = $this->resolve($path);

        if (! is_file($resolved)) {
            throw new ToolRefusal(is_dir($resolved)
                ? "Path is a directory, not a file: {$this->relative($resolved)}. Use glob to list it."
                : "File does not exist: {$this->relative($resolved)}. Use glob or grep to find the right path.");
        }

        return $resolved;
    }

    /**
     * Cesta na zápis — súbor existovať nemusí, ale jeho priečinok áno.
     *
     * Priečinky sa zámerne NEZAKLADAJÚ: preklep v ceste („aap/Services") by inak
     * vyrobil strom, o ktorom nikto nevie, a človek v náhľade vidí diff, nie
     * novú vetvu adresárov.
     *
     * @throws ToolRefusal
     */
    public function writable(string $path): string
    {
        $resolved = $this->resolve($path);

        if (is_dir($resolved)) {
            throw new ToolRefusal("Path is a directory: {$this->relative($resolved)}. Give a file path.");
        }

        if (! is_dir(dirname($resolved))) {
            throw new ToolRefusal(
                'Directory does not exist: '.$this->relative(dirname($resolved))
                .'. Create files only in directories that already exist.'
            );
        }

        return $resolved;
    }

    /**
     * Priečinok (alebo súbor) ako rozsah hľadania pre grep/glob.
     *
     * @throws ToolRefusal
     */
    public function searchScope(?string $path): string
    {
        if ($path === null || trim($path) === '' || trim($path) === '.') {
            return $this->root();
        }

        $resolved = $this->resolve($path);

        if (! file_exists($resolved)) {
            throw new ToolRefusal("Path does not exist: {$this->relative($resolved)}.");
        }

        return $resolved;
    }

    /**
     * Cesta relatívna ku koreňu — to je tvar, v ktorom sa hovorí s modelom.
     * Absolútne cesty sú v odpovedi len zaplatené tokeny a navyše prezrádzajú
     * rozloženie kontejnera.
     */
    public function relative(string $absolute): string
    {
        $root = $this->root();
        $abs = $this->normalize($absolute);

        if ($abs === $root) {
            return '.';
        }

        return str_starts_with($abs, $root.'/')
            ? substr($abs, strlen($root) + 1)
            : $abs;
    }

    /**
     * Rozloží cestu na skutočnú a overí, že smie existovať.
     *
     * @throws ToolRefusal
     */
    private function resolve(string $path): string
    {
        $path = trim($path);

        if ($path === '') {
            throw new ToolRefusal('Argument `path` is required.');
        }

        // Model píše lomky podľa toho, čo videl v tréningu; oba tvary znamenajú
        // to isté a rozdiel medzi nimi nie je bezpečnostné rozhodnutie.
        $candidate = str_replace('\\', '/', $path);
        $root = $this->root();

        $absolute = $this->isAbsolute($candidate) ? $candidate : $root.'/'.$candidate;

        $real = realpath($absolute);

        if ($real === false) {
            // Neexistujúci súbor: rozlož RODIČA a meno prilep. `basename` sa už
            // nedá rozložiť, tak sa naň pravidlá aplikujú nižšie ako na segment.
            $parent = realpath(dirname($absolute));

            if ($parent === false) {
                // Priečinok neexistuje. Povedať to nahlas sa smie len vtedy, keď je
                // NAJBLIŽŠÍ existujúci predok v koreni — inak by chybová správa
                // prezrádzala, čo je na disku mimo projektu.
                $this->assertInsideRoot($this->deepestExisting($absolute), $root);

                throw new ToolRefusal(
                    'Directory does not exist: '.dirname($candidate)
                    .'. Create files only in directories that already exist.'
                );
            }

            $name = basename($absolute);

            if ($name === '' || $name === '.' || $name === '..') {
                throw new ToolRefusal('Refused: `path` must end with a file name.');
            }

            $real = $this->normalize($parent).'/'.$name;
        } else {
            $real = $this->normalize($real);
        }

        $this->assertInsideRoot($real, $root);
        $this->assertNotDenied($real, $root);

        return $real;
    }

    /**
     * Najbližší existujúci predok cesty (rozložený). Slúži na to, aby sa dala
     * skontrolovať príslušnosť ku koreňu aj u cesty, ktorej niekoľko posledných
     * segmentov ešte neexistuje.
     */
    private function deepestExisting(string $absolute): string
    {
        $path = $absolute;

        while (true) {
            $parent = dirname($path);

            if ($parent === $path) {
                // Došli sme na koreň filesystému a nič neexistuje — nič nie je
                // v koreni projektu.
                return $parent;
            }

            $real = realpath($parent);

            if ($real !== false) {
                return $this->normalize($real);
            }

            $path = $parent;
        }
    }

    /**
     * Kontejner beží na Linuxe, ale vývojár môže mať `files_root` s Windows
     * diskom — preto sa berie do úvahy aj `C:/` a UNC. Bez toho by
     * `C:/Users/…/.env` prešlo ako relatívna cesta pod koreňom.
     */
    private function isAbsolute(string $path): bool
    {
        return $path[0] === '/'
            || preg_match('#^[A-Za-z]:/#', $path) === 1
            || str_starts_with($path, '//');
    }

    /** @throws ToolRefusal */
    private function assertInsideRoot(string $real, string $root): void
    {
        if ($real === $root || str_starts_with($real, $root.'/')) {
            return;
        }

        // Zámerne bez cieľovej cesty v texte: model nemá dostať potvrdenie, KAM
        // by sa bol dostal, a v logu konzoly to nemá čo robiť.
        throw new ToolRefusal(
            'Refused: path resolves outside the project root. '
            .'Use a path relative to the project root, without `..`.'
        );
    }

    /** @throws ToolRefusal */
    private function assertNotDenied(string $real, string $root): void
    {
        $relative = $real === $root ? '' : substr($real, strlen($root) + 1);

        foreach (self::DENY_PREFIXES as $prefix) {
            if ($relative === $prefix || str_starts_with($relative, $prefix.'/')) {
                throw new ToolRefusal("Refused: `{$prefix}` is not readable or writable from the console.");
            }
        }

        foreach (explode('/', $relative) as $segment) {
            if ($segment === '') {
                continue;
            }

            // Bodka na začiatku pokrýva `.env`, `.env.local`, `.git`, `.ssh`,
            // `.claude` — teda presne tie mená, ktoré nesú tajomstvá a stav.
            if (str_starts_with($segment, '.')) {
                throw new ToolRefusal(
                    'Refused: hidden files and directories (names starting with a dot, e.g. `.env`, `.git`) '
                    .'are not readable or writable from the console.'
                );
            }

            if (in_array(strtolower($segment), self::DENY_SEGMENTS, true)) {
                throw new ToolRefusal("Refused: `{$segment}` is not readable or writable from the console.");
            }
        }
    }

    private function normalize(string $path): string
    {
        return rtrim(str_replace('\\', '/', $path), '/');
    }
}
