<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Živý pulz agenta na verejnom kanáli 'agents' (obrazovka DASHBOARDS) — vzor
 * zrkadlí MindPulse. ShouldBroadcastNow: pošle sa okamžite bez fronty, aby
 * priebeh behu tiekol do UI v reálnom čase.
 *
 * Typy: run.started | run.progress | run.log | run.done | run.failed | run.paused
 */
class AgentPulse implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    /**
     * @param  array<string, mixed>  $data
     */
    public function __construct(
        public string $agentKey,
        public string $type,
        public array $data = [],
    ) {}

    public function broadcastOn(): Channel
    {
        return new Channel('agents');
    }

    public function broadcastAs(): string
    {
        return 'pulse';
    }

    /**
     * @return array<string, mixed>
     */
    public function broadcastWith(): array
    {
        return [
            'agent_key' => $this->agentKey,
            'type' => $this->type,
            'data' => $this->data,
            'at' => now()->toIso8601String(),
        ];
    }
}
