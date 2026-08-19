<?php

namespace App\Services\Console\Tools;

use App\Services\Console\ToolResult;

/**
 * Založenie alebo prepísanie celého súboru.
 *
 * Najsilnejší tool v celej konzole: `edit_file` bez zhody nič neurobí, `write_file`
 * prepíše všetko. Preto náhľad NIE JE informácia navyše, ale samotná ochrana —
 * pri existujúcom súbore je to diff (človek vidí, čo zmizne), pri novom celý
 * obsah (človek vidí, čo vznikne).
 *
 * Priečinky sa nezakladajú (viď {@see PathGuard::writable()}): preklep v ceste má
 * skončiť odmietnutím, nie stromom, o ktorom nikto nevie.
 */
final class WriteFileTool extends BaseTool
{
    private const PREVIEW_CAP = 8000;

    public function __construct(private readonly PathGuard $paths) {}

    public function name(): string
    {
        return 'write_file';
    }

    public function description(): string
    {
        return 'Create a new file, or REPLACE the entire content of an existing one. `content` is the whole '
            .'file, not a fragment — anything you leave out is gone. For a change to an existing file prefer '
            .'edit_file; use write_file only for a new file or a full rewrite, and read the file first so you '
            .'do not throw away code you did not look at. The directory must already exist. This is a WRITE '
            .'— the user sees a diff and has to confirm it.';
    }

    public function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'path' => ['type' => 'string', 'description' => 'File path relative to the project root.'],
                'content' => ['type' => 'string', 'description' => 'The complete new content of the file.'],
            ],
            'required' => ['path', 'content'],
        ];
    }

    public function isWrite(): bool
    {
        return true;
    }

    public function preview(array $args): ?string
    {
        [$absolute, $content] = $this->plan($args);
        $relative = $this->paths->relative($absolute);

        $preview = is_file($absolute)
            ? UnifiedDiff::between((string) @file_get_contents($absolute), $content, $relative)
            : UnifiedDiff::forNewFile($content, $relative);

        [$capped] = $this->cap($preview, self::PREVIEW_CAP, 'obsah je dlhší než náhľad');

        return $capped;
    }

    public function execute(array $args): ToolResult
    {
        [$absolute, $content] = $this->plan($args);
        $relative = $this->paths->relative($absolute);
        $existed = is_file($absolute);

        if (@file_put_contents($absolute, $content) === false) {
            throw new ToolRefusal("Cannot write {$relative} — no permission.");
        }

        $lines = $content === '' ? 0 : substr_count($content, "\n") + 1;

        return ToolResult::ok(
            ($existed ? 'Overwrote' : 'Created')." {$relative} ({$lines} lines, "
            .strlen($content).' bytes). The change is applied — do not write this file again.',
            ['path' => $relative, 'created' => ! $existed],
        );
    }

    /**
     * @param  array<string, mixed>  $args
     * @return array{0: string, 1: string}
     *
     * @throws ToolRefusal
     */
    private function plan(array $args): array
    {
        $absolute = $this->paths->writable($this->requiredString($args, 'path'));
        $content = $this->requiredText($args, 'content');

        if (is_file($absolute) && (string) @file_get_contents($absolute) === $content) {
            throw new ToolRefusal(
                'Refused: the file already has exactly this content — nothing would change.'
            );
        }

        return [$absolute, $content];
    }
}
