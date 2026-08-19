<?php

namespace App\Services\Console\Tools;

use App\Models\Node;
use App\Services\Console\ToolResult;
use App\Services\MindService;

/**
 * Štruktúra vedomia — oblasti, oddelenia, počty, slovník tagov.
 *
 * Prečo to model musí mať PRED zápisom: `mind_learn` prijme neznámu oblasť a
 * vyrobí ju. Tak sa do „Marketing & SEO" dostali React, Docker a Testing. Tento
 * tool je jediná lacná cesta, ako sa model dozvie, čo v sieti už existuje —
 * vrátane menných tvarov tagov, ktoré si inak každé vlákno vymyslí nanovo
 * („docker", „Docker", „dockeru", „containers").
 */
final class MindOverviewTool extends BaseTool
{
    public function __construct(private readonly MindService $mind) {}

    public function name(): string
    {
        return 'mind_overview';
    }

    public function description(): string
    {
        return 'Return the structure of the mind: all areas with their departments and node counts, the '
            .'allowed node types and certainty levels, and the most used tags. Call it BEFORE mind_learn or '
            .'mind_move so you pick an area, department and tags that already exist — inventing a new area '
            .'scatters the memory. Takes no arguments.';
    }

    public function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [],
            'required' => [],
        ];
    }

    public function execute(array $args): ToolResult
    {
        $data = $this->mind->overview();
        $data['totals']['needs_review'] = (int) Node::where('needs_review', true)->count();

        return ToolResult::json($data);
    }
}
