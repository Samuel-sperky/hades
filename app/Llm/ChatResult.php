<?php

namespace App\Llm;

/** ZAMKNUTÉ DTO (#11). */
final readonly class ChatResult
{
    public function __construct(
        public string $text,
        public string $model,
        public int $promptTokens = 0,
        public int $completionTokens = 0,
        public int $ms = 0,
        public float $tokPerS = 0.0,
        /** 'stop' | 'length' | 'aborted' | 'error' */
        public string $finishReason = 'stop',
        /** Dôvod chyby pre log a meta.reason; NIKDY nesmie obsahovať kľúč ani token. */
        public ?string $error = null,
    ) {}

    /** Neúspech bez výnimky — jediný správny spôsob, ako provider hlási zlyhanie. */
    public static function failed(string $model, string $reason): self
    {
        return new self(
            text: '',
            model: $model,
            finishReason: 'error',
            error: $reason,
        );
    }

    public function ok(): bool
    {
        return $this->finishReason !== 'error';
    }
}
