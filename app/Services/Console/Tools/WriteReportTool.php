<?php

namespace App\Services\Console\Tools;

use App\Services\Console\ReportWriter;
use App\Services\Console\ToolResult;

/**
 * Zápis reportu do samostatnej HTML stránky.
 *
 * Prečo je to zápisový tool, keď nič v projekte neprepisuje: report vzniká na
 * disku a hlavne sa DOSTANE PRED ČLOVEKA ako stránka, ktorú si otvorí a pošle
 * ďalej. Náhľad je tu preto na obsah, nie na škodu — človek má vidieť, čo sa
 * chystá podpísať svojím menom, kým to ešte nemá URL.
 *
 * Náhľad je jediné miesto v tomto tooli, ktoré je po slovensky: číta ho človek,
 * nie model.
 */
final class WriteReportTool extends BaseTool
{
    /** Koľko obsahu ukázať v náhľade — na rozhodnutie „áno/nie" stačí začiatok. */
    private const PREVIEW_CHARS = 400;

    public function __construct(private readonly ReportWriter $writer) {}

    public function name(): string
    {
        return 'write_report';
    }

    public function description(): string
    {
        return 'Write a standalone HTML report page and return its URL. Use this when the user asks for a '
            .'report, an overview, a summary or any output they want to LOOK AT or send on — anything longer '
            .'than a few sentences belongs here instead of in the chat answer. Write `content` as markdown '
            .'(the default and the recommended format: headings, lists, tables, code blocks all work); use '
            .'`format: "html"` only when you already have HTML. Scripts, iframes, forms and event handlers '
            .'are stripped from the report, so do not put them in. Returns the URL the user opens in the '
            .'browser — tell them that URL in your answer. This is a WRITE, the user has to confirm it.';
    }

    public function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'title' => [
                    'type' => 'string',
                    'description' => 'Short title of the report, shown as the page heading.',
                ],
                'content' => [
                    'type' => 'string',
                    'description' => 'The whole report body, markdown by default.',
                ],
                'format' => [
                    'type' => 'string',
                    'description' => 'Either "markdown" (default) or "html".',
                ],
            ],
            'required' => ['title', 'content'],
        ];
    }

    public function isWrite(): bool
    {
        return true;
    }

    public function preview(array $args): ?string
    {
        $title = $this->requiredString($args, 'title');
        $content = $this->requiredText($args, 'content');
        $format = $this->format($args);

        $head = mb_substr($content, 0, self::PREVIEW_CHARS);

        if (mb_strlen($content) > self::PREVIEW_CHARS) {
            $head .= "\n…";
        }

        return "Report „{$title}“\n"
            ."Formát: {$format} · ".number_format(mb_strlen($content), 0, ',', ' ')." znakov\n"
            ."\n"
            .$head;
    }

    public function execute(array $args): ToolResult
    {
        $report = $this->writer->write(
            $this->requiredString($args, 'title'),
            $this->requiredText($args, 'content'),
            $this->format($args),
        );

        $url = $report->url();

        return ToolResult::ok(
            "Report \"{$report->title}\" written ({$report->bytes} bytes). It is at {$url} — tell the user "
            .'to open that URL in the browser.',
            ['uuid' => $report->uuid, 'url' => $url],
        );
    }

    /**
     * Formát sa nevaliduje tu, ale v {@see ReportWriter::write()} — inak by ten
     * istý zoznam formátov žil na dvoch miestach a raz by sa rozišiel.
     *
     * @param  array<string, mixed>  $args
     */
    private function format(array $args): string
    {
        return $this->optionalString($args, 'format') ?? 'markdown';
    }
}
