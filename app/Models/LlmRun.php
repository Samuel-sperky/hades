<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Jedno volanie modelu — telemetria pre panel na obrazovke Dnes (rozhodnutie #145).
 * Vlastník P5, schéma je zamknuté rozhranie #18, konzument P10.
 */
class LlmRun extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = [
        'task', 'model', 'provider', 'prompt_tokens', 'completion_tokens',
        'ms', 'tok_per_s', 'ok', 'error', 'created_at',
    ];

    protected $casts = [
        'prompt_tokens' => 'integer',
        'completion_tokens' => 'integer',
        'ms' => 'integer',
        'tok_per_s' => 'float',
        'ok' => 'boolean',
    ];

    /** @return array<string, mixed> */
    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'task' => $this->task,
            'model' => $this->model,
            'provider' => $this->provider,
            'prompt_tokens' => $this->prompt_tokens,
            'completion_tokens' => $this->completion_tokens,
            'ms' => $this->ms,
            'tok_per_s' => round($this->tok_per_s, 1),
            'ok' => $this->ok,
            'error' => $this->error,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
