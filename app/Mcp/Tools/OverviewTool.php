<?php

namespace App\Mcp\Tools;

use App\Mcp\Tool;
use App\Models\Node;
use App\Services\MindService;

/**
 * `aura_overview` — štruktúra vedomia (oblasti, oddelenia, počty) + počet uzlov
 * čakajúcich na kontrolu, aby Claude vedel, koľko brain-indexed poznatkov treba
 * ešte overiť.
 */
class OverviewTool implements Tool
{
    public function __construct(private readonly MindService $mind) {}

    public function name(): string
    {
        return 'aura_overview';
    }

    public function description(): string
    {
        return 'Get the current structure of the mind: areas, their departments and '
            .'node counts. Use it to pick the right area/department before aura_learn.';
    }

    public function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => (object) [],
        ];
    }

    public function handle(array $args): array
    {
        $data = $this->mind->overview();
        $data['totals']['needs_review'] = (int) Node::where('needs_review', true)->count();

        return $data;
    }
}
