<?php

namespace App\Services\Console\Tools;

use App\Services\Console\CommandCage;
use App\Services\Console\ToolResult;

/**
 * Spustenie príkazu v kontejneri appky — jediný tool, ktorý vie overiť, že to,
 * čo model napísal, naozaj funguje.
 *
 * Prečo `isWrite()` VŽDY `true`, aj keď je príkaz len `ls`: klietka rozhoduje
 * o tom, čo sa smie spustiť, ale nie o tom, čo to spraví. `composer install`
 * prepíše `vendor`, `npm run build` prepíše `public`, `php artisan test` zahodí
 * tabuľky testovacej databázy — a to všetko je na bielom zozname. Rozdeliť shell
 * na „čítaci" a „zápisový" podľa príkazu by znamenalo tú istú klietku postaviť
 * druhýkrát, a druhá kópia by sa rozišla s prvou. Preto shell potvrdzuje človek,
 * bod. Povoľovanie po vzore ({@see CommandCage::pattern()}) je to, čo z toho
 * robí použiteľný nástroj a nie klikačku.
 */
final class BashTool extends BaseTool implements NarrowsAllowance
{
    public function __construct(private readonly CommandCage $cage) {}

    /**
     * „Povoliť vždy" pri shelle sa zúži na VZOR príkazu, nie na celé vlákno —
     * inak by jedno povolenie `php artisan test` otvorilo aj mazanie uzlov.
     * Viď {@see NarrowsAllowance}.
     */
    public function allowanceKey(array $args): ?string
    {
        $command = $this->optionalString($args, 'command');

        if ($command === null) {
            return null;
        }

        $pattern = $this->cage->pattern($command);

        return $pattern === '' ? null : $pattern;
    }

    public function name(): string
    {
        return 'bash';
    }

    public function description(): string
    {
        return 'Run one shell command inside the application container and get its combined output (stdout '
            .'and stderr) plus the exit code. Use this to VERIFY your work: after you change code, run the '
            .'tests with it (e.g. "php artisan test --filter SomeTest") instead of claiming the change works. '
            .'The shell is an ALLOWLIST, not a deny list — allowed are tests (php artisan test, php '
            .'vendor/bin/phpunit), read-only git (status, diff, log, show), composer and npm, '
            .'ls/cat/head/tail/wc/sort/uniq/cut/sed -n, rg and grep, and curl to localhost. A pipe (`|`) is '
            .'the only connector; chaining with `;` or `&&`, redirection and command substitution are '
            .'refused, so run one command per call. Every command is confirmed by the user before it runs, '
            .'so say in `reason` what you need it for.';
    }

    public function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'command' => [
                    'type' => 'string',
                    'description' => 'The single shell command to run, e.g. "php artisan test --filter ConsoleToolsTest".',
                ],
                'reason' => [
                    'type' => 'string',
                    'description' => 'One sentence for the user: what you need this command for.',
                ],
            ],
            'required' => ['command'],
        ];
    }

    /** Shell je zápis vždy — viď triedny komentár. */
    public function isWrite(): bool
    {
        return true;
    }

    /**
     * Náhľad ZÁMERNE nehádže {@see ToolRefusal}, ani keď klietka odmieta.
     *
     * Človek má vidieť, prečo nemá čo potvrdzovať — inak by mu dialóg zmizol pod
     * rukami a v konzole by ostalo len „tool zlyhal". Odmietnutie sa vykoná až
     * v {@see execute()}, kde má kam ísť (modelu ako výsledok).
     */
    public function preview(array $args): ?string
    {
        $command = trim((string) ($args['command'] ?? ''));
        $refusal = $this->cage->refusalFor($command);

        if ($refusal !== null) {
            return "$ {$command}\n\nKlietka tento príkaz odmieta, nie je čo potvrdzovať:\n{$refusal}";
        }

        $reason = $this->optionalString($args, 'reason');

        return "$ {$command}\n\n"
            .'adresár:  '.config('hades.console.files_root', base_path())."\n"
            .'timeout:  '.max(1, (int) config('hades.console.bash.timeout', 120))." s\n"
            .'klietka:  príkaz je na bielom zozname (vzor „'.$this->cage->pattern($command).'")'
            .($reason === null ? '' : "\n\ndôvod:    ".$reason);
    }

    public function execute(array $args): ToolResult
    {
        $command = $this->requiredString($args, 'command');
        $refusal = $this->cage->refusalFor($command);

        if ($refusal !== null) {
            throw new ToolRefusal($refusal);
        }

        $timeout = max(1, (int) config('hades.console.bash.timeout', 120));
        $result = $this->cage->run($command);

        // Exit kód na PRVOM riadku, nie na konci: výstup je skrátený od konca,
        // takže na konci by ho pri dlhom výpise model nikdy nevidel — a práve
        // z neho číta, či testy prešli.
        $head = 'exit '.$result['exit_code'];

        if ($result['timed_out']) {
            $head .= " — the command timed out after {$timeout} seconds and was killed; "
                .'below is only what it printed before that. Run a narrower command (e.g. a single '
                .'--filter) instead of repeating this one.';
        }

        $body = trim($result['output']);

        [$body, $truncated] = $this->cap(
            $body === '' ? '(no output)' : $body,
            max(1, (int) config('hades.console.bash.output_cap', 30000)),
            'narrow the command down, e.g. run one test file instead of the whole suite',
        );

        return ToolResult::ok($head."\n".$body, [
            'command' => $command,
            'pattern' => $this->cage->pattern($command),
            'exit_code' => $result['exit_code'],
            'timed_out' => $result['timed_out'],
            'duration_ms' => $result['duration_ms'],
        ], $truncated);
    }
}
