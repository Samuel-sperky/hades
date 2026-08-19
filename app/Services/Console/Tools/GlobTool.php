<?php

namespace App\Services\Console\Tools;

use App\Services\Console\ToolResult;

/**
 * Zoznam súborov podľa vzoru.
 *
 * Postavené na `rg --files`, nie na PHP `glob()`: `glob()` nevie `**`, nevie
 * `.gitignore` a musel by sa rekurzívne obchádzať ručne — teda tretia
 * implementácia prechodu stromom v jednej appke. `rg` navyše sám preskakuje
 * skryté súbory, takže sa `.env` neobjaví ani v zozname mien.
 *
 * Strop je počet CIEST, nie znakov: 200 ciest je pre model použiteľná mapa,
 * 2000 je šum, v ktorom sa nedá vybrať.
 */
final class GlobTool extends RipgrepTool
{
    private const MAX_MATCHES = 200;

    public function name(): string
    {
        return 'glob';
    }

    public function description(): string
    {
        return 'List project files whose path matches a glob pattern, e.g. "**/*.blade.php", '
            .'"app/Services/**/*.php", "*.md". Use it to find out what exists before you read anything, when '
            .'you know the shape of the name but not the path. Returns paths relative to the project root, '
            .'one per line, at most 200. Hidden files, vendor and node_modules are never listed.';
    }

    public function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'pattern' => [
                    'type' => 'string',
                    'description' => 'Glob pattern, e.g. "**/*.php". Use ** to cross directories.',
                ],
                'path' => [
                    'type' => 'string',
                    'description' => 'Optional directory to list in, relative to the project root.',
                ],
            ],
            'required' => ['pattern'],
        ];
    }

    public function execute(array $args): ToolResult
    {
        $pattern = $this->requiredString($args, 'pattern');
        $scope = $this->scope($this->optionalString($args, 'path'));

        $argv = ['--files', '--color', 'never', '--sort', 'path', '--glob', $pattern];

        foreach (self::DENY_GLOBS as $deny) {
            $argv[] = '--glob';
            $argv[] = $deny;
        }

        [$rawOutput, $exit] = $this->ripgrep([...$argv, ...$this->scopeArgv($scope)]);
        $output = $this->stripDotPrefix($rawOutput);

        $paths = array_values(array_filter(preg_split("/\R/", trim($output)) ?: []));

        if ($exit === 1 || $paths === []) {
            return ToolResult::ok(
                'No file matches `'.$pattern.'` in '.$this->scopeLabel($scope)
                .'. Remember that ** is needed to cross directories '
                .'("**/*.php", not "*.php", for a recursive search).'
            );
        }

        $total = count($paths);
        $shown = array_slice($paths, 0, self::MAX_MATCHES);

        $text = "{$total} files match `{$pattern}`";
        $text .= $total > count($shown) ? ' (first '.count($shown)." shown):\n" : ":\n";
        $text .= implode("\n", $shown);

        return ToolResult::ok(
            $text,
            ['total' => $total, 'paths' => $shown],
            $total > count($shown),
        );
    }
}
