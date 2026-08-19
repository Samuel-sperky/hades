<?php

namespace App\Services\Console;

use Symfony\Component\Process\Exception\ProcessTimedOutException;
use Symfony\Component\Process\Process;

/**
 * Klietka pre shell — gramatika príkazu, biely zoznam a samotný beh.
 *
 * Do 19. 8. 2026 konzola shell nemala vôbec, takže nevedela spustiť ani testy:
 * model písal kód naslepo a „hotovo" znamenalo „prečítal som si to". Shell to
 * spravil, ale je to zároveň najsilnejší tool v appke — preto tri rozhodnutia,
 * ktoré sa tu nesmú zmeniť:
 *
 *  1. **Biely zoznam, nie čierny.** Čierny sa dá obísť čímkoľvek, na čo autor
 *     nepomyslel (`env`, `xargs`, `sh -c`, `find -exec`); biely zlyhá opačným
 *     smerom — odmietne užitočný príkaz, čo je otrava, nie diera. Zoznam je
 *     v configu, pretože sa dolaďuje podľa projektu.
 *  2. **Gramatika je v KÓDE, nie v configu.** Reťazenie, presmerovanie a
 *     substitúcia nie sú zoznam príkazov, ale spôsob, ako biely zoznam obísť:
 *     `ls; rm -rf x` je „ls" plus čokoľvek a proti zoznamu by prešlo prvou
 *     polovicou. Keby to bolo v configu, dala by sa tá obrana vypnúť premennou
 *     prostredia.
 *  3. **`deny` sa testuje nad CELÝM príkazom a má prednosť.** Čo je v ňom, sa
 *     nedá povoliť ani cez „povoliť navždy" — inak by jeden klik človeka
 *     natrvalo otvoril `rm` alebo `git push`.
 */
final class CommandCage
{
    /**
     * Strop na dĺžku príkazu. Nie je to obrana proti dlhému príkazu, ale proti
     * tomu, aby model do `command` vysypal celý súbor — takú vetu už nikto
     * v potvrdzovacom dialógu neprečíta a človek by klikal naslepo.
     */
    private const MAX_LENGTH = 2000;

    /**
     * Sekvencie, ktoré rozdeľujú príkaz na viac príkazov alebo presúvajú jeho
     * vstup a výstup. Poradie je od najdlhšej k najkratšej zámerne: v odmietnutí
     * citujeme nájdenú sekvenciu a `&` namiesto `&&` by človeka aj model poslalo
     * hľadať niečo iné, než tam naozaj je.
     *
     * Rúra (`|`) v zozname NIE JE — je to jediná povolená spojka a jej segmenty
     * sa validujú každý zvlášť.
     */
    private const FORBIDDEN_SEQUENCES = ['&&', '||', '>>', '$(', '${', ';', '&', '`', '>', '<'];

    /**
     * Verdikt klietky: `null` = príkaz smie bežať, inak veta PRE MODEL o tom, čo
     * urobiť inak.
     *
     * Poradie pravidiel je súčasťou obrany, nie vecou vkusu: gramatika sa testuje
     * pred zoznamami, pretože až po nej je pravda, že „príkaz" je jeden príkaz —
     * a `deny` pred `allow`, aby sa zakázané nedalo prepísať povolením.
     */
    public function refusalFor(string $command): ?string
    {
        if (config('hades.console.bash.enabled') === false) {
            return 'The shell is disabled in this installation — the bash tool cannot run anything. '
                .'Do what you can with the file and memory tools instead.';
        }

        $command = trim($command);

        if ($command === '') {
            return 'Argument `command` is required — give one shell command to run.';
        }

        if (mb_strlen($command) > self::MAX_LENGTH) {
            return 'Refused: the command is longer than '.self::MAX_LENGTH.' characters. '
                .'Run one short command; put long content in a file instead.';
        }

        $structure = $this->structureRefusal($command);

        if ($structure !== null) {
            return $structure;
        }

        if ($this->unbalancedQuotes($command)) {
            return 'Refused: unbalanced quote in the command. Close it — an open quote would make the shell '
                .'wait for the rest and the command would hang until the timeout.';
        }

        // Nad celým príkazom, teda aj nad segmentmi rúry a aj nad tým, čo by
        // `allow` pustilo. Toto je jediné pravidlo, ktoré sa nedá prehlasovať.
        foreach ((array) config('hades.console.bash.deny', []) as $pattern) {
            if (preg_match((string) $pattern, $command) === 1) {
                return 'Refused: this command is on the shell deny list and cannot be enabled by anyone. '
                    .'Destructive commands, shells, `sudo`, docker, writing git operations and `.env` are '
                    .'permanently out of reach — pick a different way to get the information.';
            }
        }

        return $this->allowRefusal($command);
    }

    /**
     * Normalizovaný kľúč príkazu pre „povoliť navždy".
     *
     * Kľúč musí byť hrubší než príkaz (`php artisan test` pokrýva každý
     * `--filter`), inak by človek potvrdzoval každú variantu znova a klikanie by
     * sa stalo formalitou — a zároveň nie taký hrubý, aby `git status` povolilo
     * celé `git`. Preto pri nástrojoch s podpríkazmi dva tokeny, pri `artisan`
     * tri, inak jeden.
     */
    public function pattern(string $command): string
    {
        $first = trim($this->splitPipeline(trim($command))[0]);
        $tokens = preg_split('/\s+/', $first) ?: [];
        $tokens = array_values(array_filter($tokens, fn (string $t): bool => $t !== ''));

        if ($tokens === []) {
            return '';
        }

        // `php artisan test` a `php artisan migrate` sú z pohľadu človeka dva
        // rôzne príkazy; „php artisan" ako jeden kľúč by povolením testov povolil
        // aj migrácie.
        if (($tokens[0] ?? '') === 'php' && ($tokens[1] ?? '') === 'artisan' && isset($tokens[2])) {
            return 'php artisan '.$tokens[2];
        }

        // `npm run build` a `npm run watch` sú dva rôzne programy: skripty žijú v
        // package.json a povolením jedného sa nemá povoliť druhý.
        if (($tokens[0] ?? '') === 'npm' && ($tokens[1] ?? '') === 'run' && isset($tokens[2])) {
            return 'npm run '.$tokens[2];
        }

        // `php vendor/bin/phpunit` sem patrí tiež — druhý token je cesta k binárke,
        // teda presne to, čo príkaz odlišuje.
        if (in_array($tokens[0], ['php', 'composer', 'npm', 'node', 'git'], true) && isset($tokens[1])) {
            return $tokens[0].' '.$tokens[1];
        }

        return $tokens[0];
    }

    /**
     * Rozdelí príkaz na segmenty rúry — ale `|` VNÚTRI úvodzoviek nechá na pokoji.
     *
     * Naivné `explode('|')` tu bola funkčná chyba, nie bezpečnostná:
     * `rg -e "foo|bar" app` sa rozpadlo na `rg -e "foo` a `bar" app`, druhý segment
     * neprešel bielym zoznamom a klietka odmietla úplne legitímne hľadanie. Model
     * potom skúša variácie a na CPU inferencii je každý pokus minúta.
     *
     * Bezpečnosť to nezoslabuje: skutočné reťazenie (`;`, `&&`, `||`, `&`) aj
     * substitúciu odmieta gramatika ešte pred týmto rozdelením, a to bez ohľadu na
     * úvodzovky. Otvorená úvodzovka je odmietnutá zvlášť ({@see self::unbalancedQuotes()}) —
     * shell by inak čakal na jej dokončenie a príkaz by visel do timeoutu.
     *
     * @return array<int, string>
     */
    private function splitPipeline(string $command): array
    {
        $segments = [];
        $current = '';
        $quote = null;

        $length = strlen($command);

        for ($i = 0; $i < $length; $i++) {
            $char = $command[$i];

            if ($quote !== null) {
                $current .= $char;

                if ($char === $quote) {
                    $quote = null;
                }

                continue;
            }

            if ($char === '"' || $char === "'") {
                $quote = $char;
                $current .= $char;

                continue;
            }

            if ($char === '|') {
                $segments[] = $current;
                $current = '';

                continue;
            }

            $current .= $char;
        }

        $segments[] = $current;

        return $segments;
    }

    /** Nezavretá úvodzovka: shell by na ňu čakal, takže príkaz odmietame vopred. */
    private function unbalancedQuotes(string $command): bool
    {
        $quote = null;
        $length = strlen($command);

        for ($i = 0; $i < $length; $i++) {
            $char = $command[$i];

            if ($quote === null && ($char === '"' || $char === "'")) {
                $quote = $char;
            } elseif ($quote === $char) {
                $quote = null;
            }
        }

        return $quote !== null;
    }

    /**
     * Spustí príkaz v koreni projektu a vráti výstup, exit kód a to, či vypršal.
     *
     * PODMIENKA: volať sa smie LEN vtedy, keď {@see refusalFor()} vrátilo `null`.
     * Nič v tejto metóde už nekontroluje, čo sa spúšťa — celá obrana je pred ňou.
     *
     * Preto je v poriadku použiť shell (`fromShellCommandline`): gramatika je
     * overená vopred, takže v príkaze nie je ani jedna sekvencia, ktorou by shell
     * mohol pridať druhý príkaz, presmerovanie alebo substitúciu. Jediné, čo mu
     * ostáva, je spojiť rúru — a práve pre ňu tu shell je (argv pole rúru nevie).
     *
     * @return array{output: string, exit_code: int, timed_out: bool, duration_ms: int}
     */
    public function run(string $command): array
    {
        $timeout = max(1, (int) config('hades.console.bash.timeout', 120));

        $process = Process::fromShellCommandline(
            trim($command),
            (string) config('hades.console.files_root', base_path()),
            null,
            null,
            (float) $timeout,
        );

        // stdout a stderr do JEDNÉHO prúdu v poradí, v akom pritiekli: phpunit píše
        // zhrnutie na stdout a fatal na stderr, a rozdelené na dve polia by model
        // čítal príčinu a následok každý zvlášť.
        $output = '';
        $collect = function (string $type, string $chunk) use (&$output): void {
            $output .= $chunk;
        };

        $startedAt = microtime(true);
        $timedOut = false;

        try {
            $process->run($collect);
        } catch (ProcessTimedOutException) {
            // Vypršanie NIE JE prázdny výsledok: `php artisan test` pred zabitím
            // vypíše, ktorý test visel, a to je celá odpoveď na otázku „prečo".
            $timedOut = true;
        }

        return [
            'output' => $output,
            'exit_code' => (int) ($process->getExitCode() ?? -1),
            'timed_out' => $timedOut,
            'duration_ms' => (int) round((microtime(true) - $startedAt) * 1000),
        ];
    }

    /**
     * Gramatika: jedna riadka, jeden príkaz, žiadne presmerovanie ani substitúcia.
     */
    private function structureRefusal(string $command): ?string
    {
        if (preg_match('/\R/', $command) === 1) {
            return 'Refused: the command must be a single line. Run one command per bash call.';
        }

        foreach (self::FORBIDDEN_SEQUENCES as $sequence) {
            if (str_contains($command, $sequence)) {
                return "Refused: `{$sequence}` is not allowed. Command chaining, redirection and command "
                    .'substitution would get around the allowlist, so the only connector you can use is a '
                    .'pipe (`|`) — and every segment of the pipe has to be allowed on its own. '
                    .'Run one command per bash call.';
            }
        }

        return null;
    }

    /**
     * Biely zoznam nad každým segmentom rúry zvlášť.
     *
     * Nesediaci segment sa CITUJE: model si má vybrať iný príkaz, a bez toho, aby
     * videl, ktorá polovica rúry padla, hádže tú istú vetu s inou drobnosťou
     * dokola — čo je na CPU inferencii minúta za pokus.
     */
    private function allowRefusal(string $command): ?string
    {
        /** @var array<int, string> $allow */
        $allow = (array) config('hades.console.bash.allow', []);

        foreach ($this->splitPipeline($command) as $segment) {
            $segment = trim($segment);

            if ($segment === '') {
                return 'Refused: empty segment in the pipe — write `a | b`, not `a | | b`.';
            }

            $matched = false;

            foreach ($allow as $pattern) {
                if (preg_match((string) $pattern, $segment) === 1) {
                    $matched = true;
                    break;
                }
            }

            if (! $matched) {
                return "Refused: `{$segment}` is not on the shell allowlist. The shell has an ALLOWLIST, not a "
                    .'deny list, so guessing variants will not help — pick a different command. Allowed are '
                    .'tests (php artisan test, php vendor/bin/phpunit), read-only git (status, diff, log, show), '
                    .'composer and npm, ls/cat/head/tail/wc/sort/uniq/cut/tr, rg and grep, and curl to the '
                    .'application itself on localhost:8080. There is no `sed` — use head/tail/cut to read '
                    .'lines, or the read_file tool.';
            }
        }

        return null;
    }
}
