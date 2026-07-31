<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Jeden beh konzolového agenta spustený z command centre (obrazovka DASHBOARDS).
 * Nesie živý stav pre panel — progres, krok, log, štatistiky — a slúži ako audit
 * histórie behov. Register agentov je statický (App\Services\Agents\AgentRegistry).
 */
class AgentRun extends Model
{
    protected $fillable = [
        'agent_key', 'status', 'progress', 'step', 'log', 'stats', 'message',
        'started_at', 'finished_at',
    ];

    protected $casts = [
        'progress' => 'integer',
        'stats' => 'array',
        'started_at' => 'datetime',
        'finished_at' => 'datetime',
    ];
}
