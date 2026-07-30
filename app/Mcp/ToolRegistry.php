<?php

namespace App\Mcp;

use App\Mcp\Exceptions\ToolValidationException;
use App\Mcp\Tools\ActivateTool;
use App\Mcp\Tools\DecisionTool;
use App\Mcp\Tools\LearnTool;
use App\Mcp\Tools\OverviewTool;
use App\Mcp\Tools\RecallTool;
use App\Mcp\Tools\ShopOrdersTool;
use App\Mcp\Tools\ShopProductsTool;

/**
 * Register MCP nástrojov + mapovanie legacy názvov.
 *
 * Kanonické názvy sú `aura_*` (rozhodnutie #6). `mind_*` zostávajú ako aliasy na
 * TEN ISTÝ handler, aby Claude Code nestratil prístup k pamäti medzi commitmi —
 * ich rename v `~/.claude.json` je gate s potvrdením používateľa, nie autonómny
 * krok. Aliasy sú v `tools/list` označené ako legacy a vypnú sa jedným riadkom
 * v `.env` (`AURAAI_MCP_LEGACY_ALIASES=false`), bez zmeny kódu.
 */
class ToolRegistry
{
    /** Kanonické tooly vedomia — vždy registrované. */
    private const CORE_TOOLS = [
        LearnTool::class,
        RecallTool::class,
        ActivateTool::class,
        OverviewTool::class,
        DecisionTool::class,
    ];

    /** Tooly e-shopu — len keď je flag zapnutý A service vrstva existuje. */
    private const SHOP_TOOLS = [
        ShopOrdersTool::class,
        ShopProductsTool::class,
    ];

    /** @var array<string, Tool>|null  kanonický názov → tool (lazy) */
    private ?array $tools = null;

    /**
     * Legacy `mind_*` → kanonický `aura_*`. Odvodené z názvov, aby sa pri
     * pridaní toolu nezabudlo na alias.
     *
     * @return array<string, string>
     */
    public function aliases(): array
    {
        $map = [];

        foreach (array_keys($this->tools()) as $canonical) {
            if (str_starts_with($canonical, 'aura_')) {
                $map['mind_'.substr($canonical, strlen('aura_'))] = $canonical;
            }
        }

        return $map;
    }

    /**
     * Definície pre `tools/list`: kanonické `aura_*` a — kým sú aliasy zapnuté —
     * aj `mind_*` s poznámkou o legacy stave. Aliasy sú zámerne až za
     * kanonickými, aby model volil `aura_*`.
     */
    public function definitions(): array
    {
        $definitions = [];

        foreach ($this->tools() as $name => $tool) {
            $definitions[] = [
                'name' => $name,
                'description' => $tool->description(),
                'inputSchema' => $tool->schema(),
            ];
        }

        if (! config('mcp.legacy_aliases', true)) {
            return $definitions;
        }

        foreach ($this->aliases() as $alias => $canonical) {
            $tool = $this->tools()[$canonical];
            $definitions[] = [
                'name' => $alias,
                'description' => "(legacy alias of {$canonical} — prefer {$canonical}) ".$tool->description(),
                'inputSchema' => $tool->schema(),
            ];
        }

        return $definitions;
    }

    /** Kanonický názov pre `aura_*` aj `mind_*`; null keď tool neexistuje. */
    public function resolve(string $name): ?string
    {
        if (isset($this->tools()[$name])) {
            return $name;
        }

        return $this->aliases()[$name] ?? null;
    }

    /**
     * Nájde tool podľa kanonického názvu alebo legacy aliasu.
     *
     * @throws ToolValidationException keď tool neexistuje — je to chyba vstupu
     *                                 klienta, nie porucha servera, takže sa
     *                                 nereportuje do error logu.
     */
    public function get(string $name): Tool
    {
        $canonical = $this->resolve($name);

        if ($canonical === null) {
            throw new ToolValidationException("Unknown tool: {$name}");
        }

        return $this->tools()[$canonical];
    }

    /** @return array<string, Tool> */
    public function tools(): array
    {
        if ($this->tools !== null) {
            return $this->tools;
        }

        $classes = self::CORE_TOOLS;

        if (config('mcp.shop_tools', false)) {
            foreach (self::SHOP_TOOLS as $shopTool) {
                // service vrstvu dodáva iný balík — bez nej sa tool netvári, že existuje
                if (class_exists($shopTool::CLIENT)) {
                    $classes[] = $shopTool;
                }
            }
        }

        $tools = [];
        foreach ($classes as $class) {
            /** @var Tool $tool */
            $tool = app($class);
            $tools[$tool->name()] = $tool;
        }

        return $this->tools = $tools;
    }
}
