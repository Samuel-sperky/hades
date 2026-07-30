<?php

namespace App\Mcp;

/**
 * Jeden MCP nástroj. Kanonický názov je vždy `aura_*` (rozhodnutie #6);
 * legacy `mind_*` mapovanie drží {@see ToolRegistry}, tool o ňom nevie.
 */
interface Tool
{
    /** Kanonický názov, napr. `aura_learn`. */
    public function name(): string;

    /** Popis pre model — čo tool robí a kedy ho volať. */
    public function description(): string;

    /** JSON Schema vstupu (kľúč `inputSchema` v tools/list). */
    public function schema(): array;

    /**
     * Vykoná tool. Vracia dátový payload (obalí ho server), alebo hotovú MCP
     * odpoveď s kľúčmi `content` + `isError` (napr. odmietnutie blacklistom).
     *
     * @throws \App\Mcp\Exceptions\ToolValidationException pri chybnom vstupe
     */
    public function handle(array $args): array;
}
