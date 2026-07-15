<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

class MindPulse implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(
        public string $type,
        public array $data = [],
    ) {}

    public function broadcastOn(): Channel
    {
        return new Channel('mind');
    }

    public function broadcastAs(): string
    {
        return 'pulse';
    }

    public function broadcastWith(): array
    {
        return [
            'type' => $this->type,
            'data' => $this->data,
            'at' => now()->toIso8601String(),
        ];
    }
}
