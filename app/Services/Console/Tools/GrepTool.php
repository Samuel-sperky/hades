<?php

namespace App\Services\Console\Tools;

use App\Services\Console\ToolResult;

/**
 * Hľadanie v obsahu súborov cez `rg`.
 *
 * Toto je tool, ktorý z chatu robí niečo, čo vie naozaj nájsť. Bez neho by model
 * musel hádať cesty a čítať celé súbory — a na 16k kontexte to znamená jeden
 * súbor na vlákno.
 *
 * Metaznaky vo vzore sú OBYČAJNÉ ZNAKY: vzor ide ako jeden argv prvok, nikdy
 * nevidí shell. Viď {@see RipgrepTool}.
 */
final class GrepTool extends RipgrepTool
{
    /** Zhôd na jeden súbor — bez toho jeden generovaný súbor zaplní celý strop. */
    private const MAX_PER_FILE = 40;

    public function name(): string
    {
        return 'grep';
    }

    public function description(): string
    {
        return 'Search the text of the project files with a regular expression (ripgrep) and return matching '
            .'lines as "path:line:text". This is how you FIND things — use it before read_file whenever you '
            .'do not already know the exact path. Search is case-insensitive unless the pattern contains an '
            .'uppercase letter. Narrow it with `path` (a directory) and `glob` (e.g. "*.php"). Regex '
            .'metacharacters are matched literally as part of the pattern, nothing is executed. Hidden '
            .'files, vendor and node_modules are never searched. Output is capped; if it is cut, search for '
            .'something more specific.';
    }

    public function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'pattern' => [
                    'type' => 'string',
                    'description' => 'Regular expression to search for.',
                ],
                'path' => [
                    'type' => 'string',
                    'description' => 'Optional directory or file to search in, relative to the project root.',
                ],
                'glob' => [
                    'type' => 'string',
                    'description' => 'Optional file filter, e.g. "*.php" or "public/js/**/*.js".',
                ],
            ],
            'required' => ['pattern'],
        ];
    }

    public function execute(array $args): ToolResult
    {
        $pattern = $this->requiredText($args, 'pattern');

        if (trim($pattern) === '') {
            throw new ToolRefusal('Argument `pattern` is required.');
        }

        $scope = $this->scope($this->optionalString($args, 'path'));

        $argv = [
            '--line-number',
            '--with-filename',
            '--no-heading',
            '--color', 'never',
            // Slabý model píše dopyt malými písmenami; smart-case mu ušetrí kolo.
            '--smart-case',
            '--max-count', (string) self::MAX_PER_FILE,
            // Minifikovaný JS na jednom riadku by inak poslal 300 kB v jednom
            // „riadku" — a strop by odrezal aj všetky ostatné zhody.
            '--max-columns', '240',
            '--max-columns-preview',
            '--max-filesize', '2M',
        ];

        if ($glob = $this->optionalString($args, 'glob')) {
            $argv[] = '--glob';
            $argv[] = $glob;
        }

        foreach (self::DENY_GLOBS as $deny) {
            $argv[] = '--glob';
            $argv[] = $deny;
        }

        // `--regexp` a `--`: vzor začínajúci pomlčkou nesmie byť prepínač
        // a cesta za `--` nesmie byť vzor.
        $argv[] = '--regexp';
        $argv[] = $pattern;

        [$rawOutput, $exit] = $this->ripgrep([...$argv, ...$this->scopeArgv($scope)]);
        $output = $this->stripDotPrefix($rawOutput);
        $where = $this->scopeLabel($scope);

        if ($exit === 1 || trim($output) === '') {
            return ToolResult::ok(
                "No match for the pattern in {$where}. Try a shorter or different pattern, "
                .'or widen `path`/`glob`.'
            );
        }

        $matches = count(preg_split("/\R/", trim($output)) ?: []);

        [$body, $truncated] = $this->cap(
            trim($output),
            max(1, (int) config('hades.console.grep_cap', 20000)),
            'narrow the search with a more specific pattern, `path` or `glob`',
        );

        return ToolResult::ok(
            "{$matches} matching lines in {$where}:\n".$body,
            ['matches' => $matches, 'scope' => $scope],
            $truncated,
        );
    }
}
