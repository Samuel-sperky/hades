<?php

namespace App\Mcp\Tools;

use App\Mcp\Concerns\ValidatesArgs;
use App\Mcp\Tool;
use App\Models\Node;
use App\Services\MindService;

/**
 * `aura_recall` — vyhľadá v pamäti poznatky relevantné k téme.
 *
 * Tvar payloadu (`found` + `nodes[]` s 10 kľúčmi) je kontrakt voči Claude Code
 * a nemení sa — je prevzatý riadok za riadkom z pôvodného McpControlleru.
 */
class RecallTool implements Tool
{
    use ValidatesArgs;

    public function __construct(private readonly MindService $mind) {}

    public function name(): string
    {
        return 'aura_recall';
    }

    public function description(): string
    {
        return 'Search the mind for knowledge relevant to a topic. Call at the start '
            .'of a session with the session topic, and any time earlier context about the user, '
            .'their projects or preferences would help.';
    }

    public function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'query' => ['type' => 'string', 'description' => 'Topic or keywords to remember about'],
                'limit' => ['type' => 'integer', 'description' => 'Max nodes to return (default 12)'],
                'session_key' => SessionKey::schema(),
            ],
            'required' => ['query'],
        ];
    }

    public function handle(array $args): array
    {
        $nodes = $this->mind->recall(
            $this->requireString($args, 'query'),
            $this->clampInt($args, 'limit', 12, 1, 30),
            $this->optionalString($args, 'session_key'),
        );

        return [
            'found' => $nodes->count(),
            'nodes' => $nodes->map(fn (Node $node): array => [
                'label' => $node->label,
                'type' => $node->type,
                'area' => $node->area?->name,
                'department' => $node->department?->name,
                'strength' => (float) $node->strength,
                'certainty' => $node->certainty,
                'tags' => $node->tags()->pluck('name')->all(),
                'verified' => $node->verified_at !== null,
                'origin' => $node->origin,
                'description' => $node->description,
            ])->all(),
        ];
    }
}
