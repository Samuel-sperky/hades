<?php

namespace App\Llm;

/** ZAMKNUTÉ DTO (#11). Nové polia sa smú pridávať len na konec s defaultom. */
final readonly class ChatOptions
{
    public function __construct(
        public ?string $model = null,
        public int $maxTokens = 1500,
        public float $temperature = 0.3,
        public ?string $system = null,
        public int $timeoutMs = 90_000,
        /** @var list<string> */
        public array $stop = [],
        /** Označenie úlohy do llm_runs — 'chat', 'router', 'smart_title', 'digest', … */
        public ?string $task = null,
    ) {}
}
