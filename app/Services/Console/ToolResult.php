<?php

namespace App\Services\Console;

/**
 * Výsledok jedného volania toolu — text pre model, dáta pre smyčku.
 *
 * `text` je JEDINÉ, čo uvidí model, a je už skrátený stropmi z configu
 * (`hades.console.read_cap`, `.grep_cap`). Práve preto musí niesť aj informáciu
 * o tom, že skrátený je: model, ktorý nevie, že mu chýba koniec súboru, si
 * zvyšok domyslí — a domyslený kód je horší než chýbajúci.
 *
 * `failed` je odmietnutie alebo zlyhanie toolu, NIE výnimka. Modelu sa aj chyba
 * musí vrátiť ako výsledok (nech to skúsi inak), takže výnimka by agentovú
 * smyčku len nútila chytať a prekladať ju; {@see ToolRegistry::call()} to robí
 * raz za všetkých.
 *
 * `data` je pre smyčku a UI (napr. id práve vytvoreného uzla), nie pre model —
 * do frame-u `tool_result` ide `text`. Preto smie byť aj bohatšie než text.
 */
final class ToolResult
{
    /**
     * @param  array<string, mixed>|null  $data
     */
    private function __construct(
        public readonly string $text,
        public readonly ?array $data = null,
        public readonly bool $truncated = false,
        public readonly bool $failed = false,
        /**
         * Doplní {@see ToolRegistry::call()} — meria sa až okolo vykonania, takže
         * jediná mutovateľná vlastnosť. Tool si čas nemeria sám: potom by ho
         * musel merať každý a polovica by na to zabudla.
         */
        public ?int $durationMs = null,
    ) {}

    /**
     * @param  array<string, mixed>|null  $data
     */
    public static function ok(string $text, ?array $data = null, bool $truncated = false): self
    {
        return new self($text, $data, $truncated, false);
    }

    /**
     * Kompaktný JSON ako text pre model.
     *
     * Bez JSON_PRETTY_PRINT a s JSON_UNESCAPED_* z toho istého dôvodu ako v
     * `McpController::callTool()`: číta to výhradne stroj, odsadenie mu nedá nič a na 9 tok/s je každý znak zaplatený token.
     *
     * @param  array<string, mixed>  $data
     */
    public static function json(array $data, bool $truncated = false): self
    {
        return new self(
            (string) json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            $data,
            $truncated,
            false,
        );
    }

    /**
     * Tool odmietol alebo zlyhal. Text je pre model — má z neho vedieť, čo
     * urobiť inak, nie sa dozvedieť, že „nastala chyba".
     */
    public static function refused(string $reason): self
    {
        return new self($reason, null, false, true);
    }
}
