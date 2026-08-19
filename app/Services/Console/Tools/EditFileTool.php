<?php

namespace App\Services\Console\Tools;

use App\Services\Console\ToolResult;

/**
 * Výmena presného stringu v jednom súbore.
 *
 * Prečo výmena stringu a nie „prepíš riadky 40-52": číslo riadku je krehké —
 * model ho odhadne z výstupu grepu, súbor sa medzitým zmení a zápis pretrafí.
 * Presný string je sám sebe kontrolou: keď v súbore nie je, nič sa nestane.
 *
 * `old_string` MUSÍ byť v súbore práve raz. Dva výskyty znamenajú, že model
 * nevie, ktorý mieni — a hádať za neho je ten najhorší možný zápis. Riešenie sa
 * hovorí modelu do popisu: pridaj okolo toho viac kontextu.
 */
final class EditFileTool extends BaseTool
{
    /** Strop na náhľad pre človeka — diff, v ktorom sa nedá scrollovať, sa nečíta. */
    private const PREVIEW_CAP = 8000;

    public function __construct(private readonly PathGuard $paths) {}

    public function name(): string
    {
        return 'edit_file';
    }

    public function description(): string
    {
        return 'Replace an exact piece of text in ONE file. `old_string` must appear in the file EXACTLY '
            .'ONCE — copy it verbatim from read_file output (without the line numbers) and include enough '
            .'surrounding lines to make it unique, otherwise the edit is refused. `new_string` replaces it '
            .'and may be empty to delete the text. Indentation matters and is part of the match. Read the '
            .'file first; never guess its content. This is a WRITE — the user sees a diff and has to confirm it.';
    }

    public function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'path' => ['type' => 'string', 'description' => 'File path relative to the project root.'],
                'old_string' => [
                    'type' => 'string',
                    'description' => 'Exact text to replace, unique in the file, verbatim including indentation.',
                ],
                'new_string' => [
                    'type' => 'string',
                    'description' => 'Replacement text. Empty string deletes the old text.',
                ],
            ],
            'required' => ['path', 'old_string', 'new_string'],
        ];
    }

    public function isWrite(): bool
    {
        return true;
    }

    public function preview(array $args): ?string
    {
        [$absolute, $before, $after] = $this->plan($args);

        [$diff] = $this->cap(
            UnifiedDiff::between($before, $after, $this->paths->relative($absolute)),
            self::PREVIEW_CAP,
            'diff je dlhší než náhľad',
        );

        return $diff;
    }

    public function execute(array $args): ToolResult
    {
        [$absolute, $before, $after] = $this->plan($args);
        $relative = $this->paths->relative($absolute);

        if (@file_put_contents($absolute, $after) === false) {
            throw new ToolRefusal("Cannot write {$relative} — no permission.");
        }

        $beforeLines = substr_count($before, "\n");
        $afterLines = substr_count($after, "\n");

        return ToolResult::ok(
            "Edited {$relative} (".($afterLines - $beforeLines >= 0 ? '+' : '')
            .($afterLines - $beforeLines).' lines). The change is applied — do not repeat this edit.',
            ['path' => $relative, 'bytes' => strlen($after)],
        );
    }

    /**
     * Overí a pripraví zápis. Beží rovnako v `preview()` aj v `execute()` — človek
     * nesmie potvrdiť diff, ktorý sa potom vykoná inak (alebo vôbec).
     *
     * @param  array<string, mixed>  $args
     * @return array{0: string, 1: string, 2: string} [absolútna cesta, pred, po]
     *
     * @throws ToolRefusal
     */
    private function plan(array $args): array
    {
        $absolute = $this->paths->file($this->requiredString($args, 'path'));
        $relative = $this->paths->relative($absolute);

        $old = $this->requiredText($args, 'old_string');
        $new = $this->requiredText($args, 'new_string');

        if ($old === '') {
            throw new ToolRefusal(
                'Refused: `old_string` is empty. To create a file use write_file; to insert text, anchor it '
                .'on a line that already exists.'
            );
        }

        if ($old === $new) {
            // Nie „nič sa nestalo", ale odmietnutie: prázdna zmena je vždy chyba
            // modelu (nesprávne skopírovaný kontext) a človek by potvrdzoval nič.
            throw new ToolRefusal(
                'Refused: `old_string` and `new_string` are identical, so the file would not change.'
            );
        }

        $before = @file_get_contents($absolute);

        if ($before === false) {
            throw new ToolRefusal("Cannot read {$relative} — no permission.");
        }

        if (str_contains($before, "\0")) {
            throw new ToolRefusal("Refused: {$relative} is a binary file.");
        }

        $count = substr_count($before, $old);

        if ($count === 0) {
            throw new ToolRefusal(
                "Refused: `old_string` is not in {$relative}. Read the file again and copy the text verbatim "
                .'— whitespace and indentation are part of the match.'
            );
        }

        if ($count > 1) {
            throw new ToolRefusal(
                "Refused: `old_string` appears {$count} times in {$relative}, so it is ambiguous. Include "
                .'more surrounding lines to make it unique.'
            );
        }

        $position = strpos($before, $old);
        $after = substr($before, 0, (int) $position).$new.substr($before, (int) $position + strlen($old));

        return [$absolute, $before, $after];
    }
}
