<?php

namespace App\Mcp\Tools;

use App\Mcp\Concerns\ValidatesArgs;
use App\Mcp\Tool;
use App\Services\MindService;

/** `aura_activate` — posilní existujúci uzol, keď sa jeho skill reálne použije. */
class ActivateTool implements Tool
{
    use ValidatesArgs;

    public function __construct(private readonly MindService $mind) {}

    public function name(): string
    {
        return 'aura_activate';
    }

    public function description(): string
    {
        return 'Strengthen an existing node when its skill/knowledge is actually used '
            .'again. If the node does not exist yet, use aura_learn instead.';
    }

    public function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'label' => ['type' => 'string', 'description' => 'Label of the node being used'],
                'type' => ['type' => 'string', 'enum' => ['skill', 'memory', 'project']],
                'session_key' => SessionKey::schema(),
            ],
            'required' => ['label'],
        ];
    }

    public function handle(array $args): array
    {
        $node = $this->mind->activate(
            $this->requireString($args, 'label'),
            $this->optionalString($args, 'type'),
            $this->optionalString($args, 'session_key'),
        );

        if (! $node) {
            return [
                'action' => 'not_found',
                'hint' => 'Node does not exist yet — store it with aura_learn.',
            ];
        }

        return ['action' => 'activated', 'node' => $node];
    }
}
