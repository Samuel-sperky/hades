<?php

namespace App\Services\Console\Tools;

use Symfony\Component\Process\Exception\ExceptionInterface as ProcessException;
use Symfony\Component\Process\Process;

/**
 * Spoločné volanie `rg` pre {@see GrepTool} a {@see GlobTool}.
 *
 * PASCA, o ktorú tu ide celý čas: vzor hľadania je text od modelu, ktorý ho
 * poskladal z vety používateľa. Keby sa zlepil do shell stringu, `$(whoami)`,
 * backtick alebo `; rm -rf` by sa VYKONALI. Preto výhradne argv pole
 * ({@see Process::__construct} s poľom), nikdy `Process::fromShellCommandline()`
 * a nikdy `shell_exec`. Argv pole neprechádza shellom, takže metaznaky sú
 * obyčajné znaky vzoru.
 *
 * Druhá pasca: vzor začínajúci pomlčkou (`-i`, `--files`) by `rg` prečítal ako
 * prepínač. Preto sa posiela cez `--regexp` a cesty za `--`.
 *
 * Deny-globy sú druhá obrana, nie prvá. `rg` sám preskakuje skryté súbory a
 * `.gitignore`, takže `.env` by nenašiel ani bez nich — ale konzola nesmie
 * stáť na predvolenom nastavení cudzieho nástroja.
 */
abstract class RipgrepTool extends BaseTool
{
    /**
     * Globy sa aplikujú v poradí a posledná zhoda vyhráva, takže deny idú VŽDY
     * za používateľov glob. Ináč by `--glob '**\/.env'` prebil zákaz.
     */
    /*
     * `storage/app/console-attachments` je koreň príloh chatu. `PathGuard` ho už
     * odmieta pri čítaní jedného súboru, ale `grep`/`glob` idú cez `rg`, ktorý o
     * `PathGuard`e nevie — obrana tak visela na tom, že `rg` ctí `storage/app/.gitignore`.
     * To je náhoda, nie pravidlo: prílohy sú súbory od cudzieho a beh iného vlákna
     * ich nemá čo prehľadávať.
     */
    protected const DENY_GLOBS = ['!.*', '!vendor', '!node_modules', '!storage/framework', '!storage/app/console-attachments'];

    /** Sekundy — pomalý model už tak čaká; visiaci `rg` by mu zjedol celý ťah. */
    protected const TIMEOUT = 20.0;

    public function __construct(protected readonly PathGuard $paths) {}

    /**
     * @param  array<int, string>  $argv  argumenty BEZ mena binárky
     * @return array{0: string, 1: int} [výstup, exit kód]
     *
     * @throws ToolRefusal
     */
    protected function ripgrep(array $argv): array
    {
        $process = new Process(['rg', ...$argv], $this->paths->root(), null, null, self::TIMEOUT);

        try {
            $process->run();
        } catch (ProcessException $e) {
            // Chýbajúca binárka je chyba nasadenia, nie modelu — a model sa z nej
            // nemá pokúšať zotaviť ďalším volaním.
            throw new ToolRefusal('ripgrep (rg) is not available in this container — this tool cannot run.');
        }

        $exit = (int) $process->getExitCode();

        // 0 = zhoda, 1 = žiadna zhoda (nie chyba), 2+ = skutočná chyba.
        if ($exit >= 2) {
            $error = trim($process->getErrorOutput());
            $first = trim((string) (preg_split("/\R/", $error)[0] ?? ''));

            throw new ToolRefusal('ripgrep failed: '.($first !== '' ? $first : 'unknown error').'.');
        }

        return [$process->getOutput(), $exit];
    }

    /**
     * Cesta pre `rg` relatívna ku koreňu — `rg` beží s `cwd` v koreni, takže aj
     * vypíše relatívne cesty a nemusíme ich prepisovať v každom riadku výstupu
     * (a absolútne cesty by boli len zaplatené tokeny plus rozloženie kontejnera).
     */
    protected function scope(?string $path): string
    {
        return $this->paths->relative($this->paths->searchScope($path));
    }

    /**
     * Rozsah ako argumenty za `--`.
     *
     * PASCA: cesta sa musí poslať VŽDY. `rg` bez cesty nečíta `cwd`, ale STDIN —
     * a ten Symfony Process zavrie, takže hľadanie ticho nenájde nič. Vyzerá to
     * ako „žiadna zhoda", nie ako chyba, a je to ten najhorší druh poruchy.
     *
     * @return array<int, string>
     */
    protected function scopeArgv(string $scope): array
    {
        return ['--', $scope];
    }

    /**
     * `rg … -- .` predsadí každej ceste `./`. Pri stovkách zhôd je to niekoľko
     * stoviek zaplatených tokenov za nič a model to potom kopíruje do `read_file`.
     */
    protected function stripDotPrefix(string $output): string
    {
        return (string) preg_replace('#^\./#m', '', $output);
    }

    /** Ako sa o rozsahu hovorí modelu. */
    protected function scopeLabel(string $scope): string
    {
        return $scope === '.' ? 'the project' : $scope;
    }
}
