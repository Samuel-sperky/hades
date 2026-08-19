<?php

namespace App\Services\Console\Tools;

use App\Services\Console\ToolResult;
use App\Services\MindService;

/**
 * Presun uzla do inej oblasti / oddelenia.
 *
 * Neznáme meno oblasti tu končí výnimkou z {@see MindService::move()} a to je
 * správne: tichý fallback na „prvú oblasť podľa id" dostal React, Docker,
 * Backend a Testing do oblasti „Marketing & SEO". Model má oblasť vybrať
 * z `mind_overview`, nie ju vysloviť.
 */
final class MindMoveTool extends BaseTool
{
    use ResolvesNode;

    public function __construct(private readonly MindService $mind) {}

    public function name(): string
    {
        return 'mind_move';
    }

    public function description(): string
    {
        return 'Move ONE node of the mind into a different area (and optionally a department). Use it when a '
            .'node sits in the wrong part of the mind. The area and department must ALREADY EXIST — call '
            .'mind_overview and pick from what it returns; an unknown name is refused, not created. This is '
            .'a WRITE — the user has to confirm it.';
    }

    public function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'id' => ['type' => 'integer', 'description' => 'Node id from mind_recall.'],
                'label' => ['type' => 'string', 'description' => 'Exact label — only when you have no id.'],
                'area' => ['type' => 'string', 'description' => 'Target area name from mind_overview.'],
                'department' => ['type' => 'string', 'description' => 'Optional department inside that area.'],
            ],
            'required' => ['area'],
        ];
    }

    public function isWrite(): bool
    {
        return true;
    }

    public function preview(array $args): ?string
    {
        $node = $this->resolveNode($args, $this->mind, ['area', 'department']);
        $area = $this->requiredString($args, 'area');
        $department = $this->optionalString($args, 'department');

        $from = ($node->area?->name ?? '—').($node->department ? ' / '.$node->department->name : '');
        $to = $area.($department !== null ? ' / '.$department : '');

        return "Presun uzla #{$node->id} („{$node->label}“)\n- {$from}\n+ {$to}";
    }

    public function execute(array $args): ToolResult
    {
        $node = $this->resolveNode($args, $this->mind, ['area', 'department']);

        $from = [
            'area' => $node->area?->name,
            'department' => $node->department?->name,
        ];

        // Neznáma oblasť/oddelenie = InvalidArgumentException z MindService.
        // ToolRegistry ju preloží na odmietnutie s dôvodom, takže model dostane
        // vetu, z ktorej sa vie odraziť („zavolaj mind_overview").
        $node = $this->mind->move($node, $this->requiredString($args, 'area'), $this->optionalString($args, 'department'));
        $node->load(['area', 'department']);

        return ToolResult::json(array_filter([
            'action' => 'moved',
            'id' => $node->id,
            'label' => $node->label,
            'from' => array_filter($from, fn ($v) => $v !== null),
            'area' => $node->area?->name,
            'department' => $node->department?->name,
        ], fn ($v) => $v !== null && $v !== []));
    }
}
