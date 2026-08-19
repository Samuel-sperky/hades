<?php

namespace App\Services\Console\Tools;

use App\Services\Console\ToolResult;

/**
 * Prečítanie súboru s číslami riadkov.
 *
 * Čísla riadkov nie sú kozmetika: model sa na ne odvoláva v odpovedi človeku
 * („v `sim.js:214` je…") a bez nich by ich musel počítať, čo slabý model robí
 * zle. `edit_file` ich nepotrebuje — ten hľadá presný string — takže sú tu
 * naozaj len na citovanie.
 *
 * Prečo `start_line`/`end_line` a nie len celý súbor: `read_cap` je 60 000
 * znakov, čo je ~15 000 tokenov — teda celé kontextové okno lokálneho modelu na
 * JEDEN súbor. Bez možnosti prečítať rozsah by prvý `read_file` nad `mind.css`
 * ukončil vlákno. Model má najprv grepnúť a potom prečítať okolie zásahu; presne
 * to mu hovorí popis.
 */
final class ReadFileTool extends BaseTool
{
    public function __construct(private readonly PathGuard $paths) {}

    public function name(): string
    {
        return 'read_file';
    }

    public function description(): string
    {
        return 'Read a text file from the project and return it with line numbers, so you can cite exact '
            .'lines. `path` is relative to the project root (e.g. "app/Services/MindService.php"). Big '
            .'files are cut at a character cap and the output says so — for a big file use grep first and '
            .'then read only the range you need with `start_line` and `end_line`. Hidden files (.env, .git), '
            .'vendor and node_modules are refused. Returns the file content, never a summary.';
    }

    public function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'path' => [
                    'type' => 'string',
                    'description' => 'File path relative to the project root.',
                ],
                'start_line' => [
                    'type' => 'integer',
                    'description' => 'Optional first line to read (1-based).',
                ],
                'end_line' => [
                    'type' => 'integer',
                    'description' => 'Optional last line to read (inclusive).',
                ],
            ],
            'required' => ['path'],
        ];
    }

    public function execute(array $args): ToolResult
    {
        $absolute = $this->paths->file($this->requiredString($args, 'path'));
        $relative = $this->paths->relative($absolute);

        $content = @file_get_contents($absolute);

        if ($content === false) {
            throw new ToolRefusal("Cannot read {$relative} — no permission or the file disappeared.");
        }

        // Binárka nemá pre model žiadnu hodnotu a v kontexte je to niekoľko tisíc
        // tokenov náhodných bajtov. NUL bajt je najlacnejší spoľahlivý test.
        if (str_contains($content, "\0")) {
            return ToolResult::ok(
                "{$relative}: binary file (".number_format(strlen($content)).' bytes), not shown.'
            );
        }

        $lines = preg_split("/\r\n|\n|\r/", $content) ?: [];
        $total = count($lines);

        $start = max(1, $this->optionalInt($args, 'start_line') ?? 1);
        $end = $this->optionalInt($args, 'end_line');
        $end = $end === null ? $total : min($total, max($start, $end));

        if ($start > $total) {
            throw new ToolRefusal("{$relative} has only {$total} lines — `start_line` {$start} is past the end.");
        }

        $numbered = '';
        // Šírka podľa najvyššieho čísla: nezarovnané čísla rozhodia zobrazenie
        // aj model, ktorý potom cituje "1 23" ako číslo riadku.
        $width = strlen((string) $end);
        for ($i = $start; $i <= $end; $i++) {
            $numbered .= str_pad((string) $i, $width, ' ', STR_PAD_LEFT).'  '.$lines[$i - 1]."\n";
        }

        $header = "{$relative} (lines {$start}-{$end} of {$total})\n";

        [$body, $truncated] = $this->cap(
            $numbered,
            max(1, (int) config('hades.console.read_cap', 60000)),
            'read a smaller range with start_line/end_line, or grep for what you need',
        );

        return ToolResult::ok($header.$body, [
            'path' => $relative,
            'lines' => $total,
            'shown' => [$start, $end],
        ], $truncated);
    }
}
