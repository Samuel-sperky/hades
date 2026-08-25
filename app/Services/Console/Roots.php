<?php

namespace App\Services\Console;

use Illuminate\Support\Str;

/**
 * Pomenované korene lokálnych dát — jediný zdroj pravdy o tom, KDE appka smie
 * čítať, kam smie zapisovať a čo sa smie indexovať do pamäte.
 *
 * Dodnes existoval jeden koreň (`hades.console.files_root`) zadrôtovaný priamo
 * v {@see \App\Services\Console\Tools\PathGuard}. Kontrakt §3 („Lokálne dáta")
 * žiada viac koreňov — priečinok s dokumentmi, poznámky, druhý projekt — a každý
 * z nich je NOVÁ útočná plocha, pretože appka je verejne tunelovaná cez ngrok.
 * Preto tu nie je len zoznam ciest, ale aj pravidlá, ktoré ten zoznam obmedzujú.
 *
 * Štyri rozhodnutia, ktoré sa nesmú zmeniť:
 *
 *  1. **Prázdna konfigurácia = dnešné chovanie, znak po znaku.** Bez
 *     `hades.console.roots` vráti {@see all()} presne jeden koreň — ten istý
 *     `files_root`, ktorý PathGuard používal predtým, s rovnakým `realpath`
 *     rozložením. Viac koreňov je schopnosť, ktorá sa zapína konfiguráciou, nie
 *     zmena chovania, ktorá príde s nasadením.
 *  2. **Koreň sa ODMIETA, nespravuje.** Nastavený koreň, ktorý neexistuje, má
 *     zakázaný segment v ceste alebo leží v priečinku príloh, sa **zahodí celý**
 *     a dôvod je čitateľný v {@see rejected()}. Nikdy sa neskracuje ani
 *     nepresúva „na najbližšie povolené miesto" — to je to isté zlo ako
 *     sanitizovaná cesta: ticho číta niekde inde, než si operátor myslí.
 *  3. **Rozhoduje `realpath`, teda CIEĽ.** Koreň aj každý súbor pod ním sa
 *     rozloží a až potom sa kontroluje. Symlink von z koreňa sa tým rozbalí
 *     a odmietne — `notes/link/x` vyzerá nevinne a môže mieriť na `/etc`.
 *  4. **Implicitný koreň sa deny pravidlami NEVALIDUJE, nakonfigurované áno.**
 *     `files_root` je appka sama (`base_path()`), a vo worktree je to
 *     `…/.claude/worktrees/<vetva>` — teda cesta so segmentom na bodku. Keby sa
 *     pravidlo o bodke aplikovalo aj na koreň, vo worktree by zhasli všetky
 *     súborové tooly naraz. Pravidlá platia na cesty POD koreňom; nové korene
 *     navyše validujeme aj samotné, pretože sú to cudzie priečinky.
 *
 * Indexovanie je **opt-in per koreň** (`'index' => true`). Default je vypnuté
 * zámerne: `mind:index-docs` zakladá uzly v pamäti a koreň s tisíckami súborov
 * by ju zaplavil skôr, než by si to niekto všimol.
 */
final class Roots
{
    /** Meno implicitného koreňa — `hades.console.files_root`, teda projekt sám. */
    public const DEFAULT_NAME = 'project';

    /**
     * Celé segmenty, ktoré cesta pod koreňom nesmie obsahovať.
     *
     * Zrkadlo `PathGuard::DENY_SEGMENTS` — kým PathGuard drží vlastnú kópiu,
     * `LocalRootsTest::test_deny_rules_agree_with_pathguard` obe strany pinuje,
     * aby sa nedali rozísť. Po napojení PathGuardu na túto triedu zostane
     * hodnota len tu.
     */
    public const DENY_SEGMENTS = ['.env', '.git', 'vendor', 'node_modules'];

    /** Zakázané prefixy relatívnej cesty. Zrkadlo `PathGuard::DENY_PREFIXES`. */
    public const DENY_PREFIXES = ['storage/framework', 'storage/app/console-attachments'];

    /**
     * Meno koreňa: malé písmená, 2–24 znakov.
     *
     * Dva znaky sú minimum zámerne — jednoznakové meno by v tvare `<meno>:cesta`
     * kolidovalo s Windows diskom (`c:/Users/…`), ktorý PathGuard rozpoznáva ako
     * absolútnu cestu.
     */
    private const NAME_PATTERN = '/^[a-z][a-z0-9_-]{1,23}$/';

    /** @var list<array{name:string,path:string,label:string,writable:bool,index:bool,area:?string,extensions:list<string>}>|null */
    private ?array $roots = null;

    /** @var array<string, string> meno koreňa → dôvod odmietnutia */
    private array $rejected = [];

    /**
     * Použiteľné korene. Prvý je vždy implicitný `project`; nakonfigurované
     * nasledujú v poradí z configu.
     *
     * @return list<array{name:string,path:string,label:string,writable:bool,index:bool,area:?string,extensions:list<string>}>
     */
    public function all(): array
    {
        if ($this->roots !== null) {
            return $this->roots;
        }

        $this->rejected = [];
        $roots = [];

        // Implicitný koreň. Keď sa nerozloží, zoznam je PRÁZDNY — fail-closed:
        // pokazený koreň neznamená „celý disk", znamená „žiadne súbory".
        $default = $this->resolveDir((string) config('hades.console.files_root', base_path()));

        if ($default !== null) {
            $roots[self::DEFAULT_NAME] = [
                'name' => self::DEFAULT_NAME,
                'path' => $default,
                'label' => 'Projekt',
                // Projekt je jediný koreň, do ktorého sa dnes zapisuje — a to
                // sa touto triedou nemení.
                'writable' => true,
                // Projekt sa NEINDEXUJE: jeho `.md` už berie `mind:brain-sync`
                // (skills, brain_paths) a zvyšok je zdrojový kód, nie dokument.
                'index' => false,
                'area' => null,
                'extensions' => $this->defaultExtensions(),
            ];
        } else {
            $this->rejected[self::DEFAULT_NAME] = 'hades.console.files_root sa nedá rozložiť na existujúci priečinok';
        }

        foreach ((array) config('hades.console.roots', []) as $name => $definition) {
            // Definícia môže byť aj samotná cesta (`'docs' => '/data/docs'`).
            // Pretypovanie ide PRVÉ — čítať `['name']` zo stringu je v PHP 8.4
            // chyba, nie prázdna hodnota.
            $definition = is_array($definition) ? $definition : ['path' => $definition];
            $name = is_string($name) ? $name : (string) ($definition['name'] ?? '');

            $reason = $this->validate($name, $definition, $roots);

            if ($reason !== null) {
                $this->rejected[$name === '' ? '(bez mena)' : $name] = $reason;

                continue;
            }

            /** @var string $path  validate() ho už rozložil */
            $path = $this->resolveDir((string) $definition['path']);

            $roots[$name] = [
                'name' => $name,
                'path' => $path,
                'label' => (string) ($definition['label'] ?? Str::headline($name)),
                'writable' => (bool) ($definition['writable'] ?? false),
                'index' => (bool) ($definition['index'] ?? false),
                'area' => isset($definition['area']) ? (string) $definition['area'] : null,
                'extensions' => $this->extensionsOf($definition),
            ];
        }

        return $this->roots = array_values($roots);
    }

    /**
     * Prečo bol koreň zahodený. Volajúci to má vypísať — koreň, ktorý ticho
     * neexistuje, sa hľadá hodinu.
     *
     * @return array<string, string> meno → dôvod
     */
    public function rejected(): array
    {
        $this->all();

        return $this->rejected;
    }

    /**
     * Implicitný koreň, alebo `null` keď sa nedá rozložiť. Rozhodnutie, čo
     * s `null` urobiť, patrí volajúcemu: PathGuard z toho robí `ToolRefusal`,
     * príkaz chybu na výstupe.
     *
     * @return array{name:string,path:string,label:string,writable:bool,index:bool,area:?string,extensions:list<string>}|null
     */
    public function default(): ?array
    {
        return $this->byName(self::DEFAULT_NAME);
    }

    /**
     * @return array{name:string,path:string,label:string,writable:bool,index:bool,area:?string,extensions:list<string>}|null
     */
    public function byName(string $name): ?array
    {
        foreach ($this->all() as $root) {
            if ($root['name'] === $name) {
                return $root;
            }
        }

        return null;
    }

    /** Mená použiteľných koreňov — pre chybové správy a pre `--root=`. */
    public function names(): array
    {
        return array_map(fn (array $r) => $r['name'], $this->all());
    }

    /**
     * Koreň, pod ktorý rozložená absolútna cesta patrí — alebo `null`, keď
     * nepatrí pod žiadny.
     *
     * Pri vnorených koreňoch vyhráva NAJDLHŠIA zhoda. Vnorený koreň tak vie
     * podmnožinu iného koreňa spraviť read-only a nikdy naopak: keby vyhrával
     * kratší, `'docs' => ['writable' => false]` vnorený v projekte by
     * neobmedzil nič.
     *
     * @return array{name:string,path:string,label:string,writable:bool,index:bool,area:?string,extensions:list<string>}|null
     */
    public function owning(string $absolute): ?array
    {
        $path = $this->normalize($absolute);
        $best = null;

        foreach ($this->all() as $root) {
            if ($path !== $root['path'] && ! str_starts_with($path, $root['path'].'/')) {
                continue;
            }

            if ($best === null || strlen($root['path']) > strlen($best['path'])) {
                $best = $root;
            }
        }

        return $best;
    }

    /**
     * Rozdelí `<koreň>:<cesta>` na koreň a zvyšok.
     *
     * `name` je `null`, keď cesta prefix nemá (teda mieri do implicitného
     * koreňa — dnešné chovanie). `name` vyplnené a `root` `null` znamená
     * **neznámy koreň**: to je odmietnutie, nie dôvod skúsiť to inak.
     *
     * Windows disk sa prefixom nikdy nestane — `C:/Users` má pred dvojbodkou
     * jeden znak a {@see NAME_PATTERN} žiada aspoň dva.
     *
     * @return array{name: ?string, root: ?array<string, mixed>, path: string}
     */
    public function split(string $path): array
    {
        $candidate = str_replace('\\', '/', trim($path));
        $colon = strpos($candidate, ':');

        if ($colon === false) {
            return ['name' => null, 'root' => null, 'path' => $candidate];
        }

        $prefix = substr($candidate, 0, $colon);

        // Dvojbodka až za lomkou je súčasťou názvu súboru, nie prefix koreňa.
        if ($prefix === '' || str_contains($prefix, '/') || preg_match(self::NAME_PATTERN, $prefix) !== 1) {
            return ['name' => null, 'root' => null, 'path' => $candidate];
        }

        return [
            'name' => $prefix,
            'root' => $this->byName($prefix),
            'path' => ltrim(substr($candidate, $colon + 1), '/'),
        ];
    }

    /**
     * Cesta v tvare, v ktorom sa o nej hovorí s modelom: relatívna ku svojmu
     * koreňu, a pri inom než implicitnom koreni s prefixom `<koreň>:`.
     *
     * Bez prefixu by model dostal `notes/x.md` a pri ďalšom volaní by ho hľadal
     * v projekte — teda inde, než odkiaľ to prečítal.
     */
    public function label(string $absolute): string
    {
        $path = $this->normalize($absolute);
        $root = $this->owning($path);

        if ($root === null) {
            return $path;
        }

        $relative = $path === $root['path'] ? '.' : substr($path, strlen($root['path']) + 1);

        return $root['name'] === self::DEFAULT_NAME ? $relative : $root['name'].':'.$relative;
    }

    /**
     * Dôvod, prečo je relatívna cesta pod koreňom zakázaná — alebo `null`.
     *
     * Jedna funkcia pre enumerátor aj pre guard: dve kópie tých istých
     * bezpečnostných pravidiel sa rozídu, a rozišla by sa tá, ktorú nikto
     * netestuje.
     */
    public function deniedReason(string $relative): ?string
    {
        $relative = trim(str_replace('\\', '/', $relative), '/');

        foreach (self::DENY_PREFIXES as $prefix) {
            if ($relative === $prefix || str_starts_with($relative, $prefix.'/')) {
                return $prefix;
            }
        }

        foreach (explode('/', $relative) as $segment) {
            if ($segment === '') {
                continue;
            }

            // Bodka na začiatku pokrýva `.env`, `.env.local`, `.git`, `.ssh`,
            // `.claude` — teda mená, ktoré nesú tajomstvá a stav.
            if (str_starts_with($segment, '.')) {
                return $segment;
            }

            if (in_array(strtolower($segment), self::DENY_SEGMENTS, true)) {
                return $segment;
            }
        }

        return null;
    }

    /**
     * Absolútne prefixy zakázané pod KAŽDÝM koreňom.
     *
     * Dnes je to koreň príloh chatu. Relatívny prefix
     * `storage/app/console-attachments` platí len voči `base_path()`, takže
     * koreň nastavený na `storage/app` by ho obišiel — a model vo vlákne A by
     * čítal prílohu vlákna B. Preto sa kontroluje aj absolútne.
     *
     * Neexistujúci priečinok príloh sa normalizuje bez `realpath` — zakázaný
     * musí byť už predtým, než ho prvý upload založí.
     *
     * @return list<string>
     */
    public function deniedAbsolutePrefixes(): array
    {
        $configured = (string) config(
            'hades.console.attachments_root',
            storage_path('app/console-attachments'),
        );

        $real = realpath($configured);

        return [$this->normalize($real === false ? $configured : $real)];
    }

    /**
     * Korene označené na indexovanie do pamäte.
     *
     * @return list<array<string, mixed>>
     */
    public function indexable(?string $only = null): array
    {
        return array_values(array_filter(
            $this->all(),
            fn (array $r) => $r['index'] && ($only === null || $r['name'] === $only),
        ));
    }

    /** Prefix `external_key` uzlov z tohto koreňa — scope pre „súbor zmizol". */
    public function keyPrefix(array $root): string
    {
        return 'root:'.$root['name'].':';
    }

    /**
     * Deskriptory dokumentov pod koreňom, v tvare, ktorý konzumuje
     * {@see \App\Services\Brain\BrainFileParser} — parser sa tým znovu použije
     * a nevzniká druhé parsovanie tých istých `.md`.
     *
     * Preskočí sa (a v deskriptoroch teda nie je):
     *   - všetko, na čo povie `deniedReason()` (dotfiles, `.env`, `.git`,
     *     `vendor`, `node_modules`, `storage/framework`, koreň príloh),
     *   - symlink, ktorého cieľ vedie von z koreňa alebo je rozbitý,
     *   - súbor s inou príponou, než koreň povoľuje.
     *
     * `meta.root` sa do deskriptora ZÁMERNE nedáva: `BrainFileParser` by ju
     * uložil do uzla a `BrainWriter::update()` berie `meta.root` ako cieľ zápisu
     * BEZ kontroly `writable` — read-only koreň by tým prestal byť read-only.
     * Identitu zdroja nesie `source_key`.
     *
     * @return list<array<string, mixed>>
     */
    public function files(array $root): array
    {
        if (! is_dir($root['path'])) {
            return [];
        }

        $extensions = $root['extensions'];
        $denied = $this->deniedAbsolutePrefixes();
        $out = [];

        $directory = new \RecursiveDirectoryIterator(
            $root['path'],
            \FilesystemIterator::SKIP_DOTS | \FilesystemIterator::UNIX_PATHS,
        );

        // Filter beží aj na priečinky, takže zakázaná vetva sa NEPRECHÁDZA —
        // `node_modules` sa tým ani neotvorí, nielen nezaindexuje.
        $filter = new \RecursiveCallbackFilterIterator(
            $directory,
            function (\SplFileInfo $file) use ($root, $denied): bool {
                $real = realpath($file->getPathname());

                if ($real === false) {
                    return false; // rozbitý symlink
                }

                $real = $this->normalize($real);

                // Symlink von z koreňa: rozhoduje CIEĽ, nie zápis cesty.
                if ($real !== $root['path'] && ! str_starts_with($real, $root['path'].'/')) {
                    return false;
                }

                foreach ($denied as $prefix) {
                    if ($real === $prefix || str_starts_with($real, $prefix.'/')) {
                        return false;
                    }
                }

                return $this->deniedReason($this->relativeTo($real, $root['path'])) === null;
            },
        );

        foreach (new \RecursiveIteratorIterator($filter) as $file) {
            /** @var \SplFileInfo $file */
            if (! $file->isFile()) {
                continue;
            }

            if (! in_array(strtolower($file->getExtension()), $extensions, true)) {
                continue;
            }

            $real = $this->normalize((string) realpath($file->getPathname()));
            $relative = $this->relativeTo($real, $root['path']);

            $out[] = [
                'source_key' => 'root:'.$root['name'],
                // `nodes.type` je enum core|skill|memory|project — lokálny
                // dokument je spomienka, rovnako ako externý `.md` mozog.
                'type' => 'memory',
                'source' => 'local-doc',
                // Identita je RELATÍVNA CESTA, nie obsah: edit textu je nový
                // content_hash toho istého uzla, nie nový uzol.
                'external_key' => 'root:'.$root['name'].':'.substr(sha1($relative), 0, 16),
                'abs_path' => $real,
                'rel_path' => $relative,
                'size' => (int) $file->getSize(),
                'area_slug' => $root['area'],
                'department' => null,
                'fallback_label' => Str::headline(pathinfo($relative, PATHINFO_FILENAME)),
                'writable' => $root['writable'],
                'root_name' => $root['name'],
            ];
        }

        // Poradie nesmie závisieť od poradia `scandir` v OS — `--limit` by inak
        // pri každom behu spracoval inú množinu.
        usort($out, fn (array $a, array $b) => strcmp($a['rel_path'], $b['rel_path']));

        return $out;
    }

    /**
     * Prípony, ktoré sa indexujú. Kód a binárky sa neindexujú vôbec: uzol má
     * niesť poznatok, nie zdrojový súbor.
     *
     * @return list<string>
     */
    public function defaultExtensions(): array
    {
        $configured = (array) config('hades.local_index.extensions', ['md', 'markdown', 'txt']);

        return $this->normalizeExtensions($configured);
    }

    // ------------------------------------------------------------------

    /** @return list<string> */
    private function extensionsOf(array $definition): array
    {
        if (! isset($definition['extensions'])) {
            return $this->defaultExtensions();
        }

        $own = $this->normalizeExtensions((array) $definition['extensions']);

        return $own === [] ? $this->defaultExtensions() : $own;
    }

    /** @return list<string> */
    private function normalizeExtensions(array $extensions): array
    {
        $out = [];

        foreach ($extensions as $extension) {
            $extension = strtolower(ltrim(trim((string) $extension), '.'));

            if ($extension !== '' && ! in_array($extension, $out, true)) {
                $out[] = $extension;
            }
        }

        return $out;
    }

    /**
     * Dôvod odmietnutia nakonfigurovaného koreňa, alebo `null` keď je v poriadku.
     *
     * @param  array<string, mixed>  $definition
     * @param  array<string, array<string, mixed>>  $taken
     */
    private function validate(string $name, array $definition, array $taken): ?string
    {
        if (preg_match(self::NAME_PATTERN, $name) !== 1) {
            return 'meno musí byť 2–24 znakov [a-z0-9_-] a začínať písmenom';
        }

        if ($name === self::DEFAULT_NAME) {
            return 'meno „'.self::DEFAULT_NAME.'" je vyhradené implicitnému koreňu (hades.console.files_root)';
        }

        if (isset($taken[$name])) {
            return 'meno je už obsadené';
        }

        $raw = trim((string) ($definition['path'] ?? ''));

        if ($raw === '') {
            return 'chýba `path`';
        }

        $path = $this->resolveDir($raw);

        if ($path === null) {
            return 'cesta neexistuje alebo nie je priečinok';
        }

        // Nakonfigurovaný koreň validujeme aj SÁM (na rozdiel od implicitného):
        // je to cudzí priečinok a `'path' => '/home/x/.ssh'` nemá byť preklep,
        // ktorý sa dá prehliadnuť.
        foreach (explode('/', $path) as $segment) {
            if ($segment === '' || preg_match('#^[A-Za-z]:$#', $segment) === 1) {
                continue;
            }

            if (str_starts_with($segment, '.')) {
                return "cesta obsahuje skrytý segment `{$segment}`";
            }

            if (in_array(strtolower($segment), self::DENY_SEGMENTS, true)) {
                return "cesta obsahuje zakázaný segment `{$segment}`";
            }
        }

        foreach ($this->deniedAbsolutePrefixes() as $prefix) {
            if ($path === $prefix || str_starts_with($path, $prefix.'/')) {
                return 'cesta leží v koreni príloh chatu';
            }
        }

        return null;
    }

    /** Rozložený existujúci priečinok, alebo `null`. */
    private function resolveDir(string $path): ?string
    {
        $path = trim($path);

        if ($path === '') {
            return null;
        }

        $real = realpath($path);

        return $real !== false && is_dir($real) ? $this->normalize($real) : null;
    }

    private function relativeTo(string $absolute, string $root): string
    {
        return $absolute === $root ? '' : ltrim(substr($absolute, strlen($root)), '/');
    }

    private function normalize(string $path): string
    {
        return rtrim(str_replace('\\', '/', $path), '/');
    }
}
