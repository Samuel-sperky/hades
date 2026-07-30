<?php

namespace App\Services\Chat;

/**
 * Hotová odpoveď chatu. Vlastník P5.
 *
 * `source` = 'template' (čísla a fakty zložil kód) alebo 'model' (voľná odpoveď
 * eskalačnej vetvy). `degraded` je true, keď sa vrstva 2/3 nemohla uplatniť —
 * UI zobrazí diskrétny stav a HTTP kód zostáva 200 (rozhodnutie #119).
 */
final readonly class ChatAnswer
{
    /** @param  list<int>  $citations */
    public function __construct(
        public string $text,
        public Intent $intent,
        public array $citations = [],
        public bool $degraded = false,
        public ?string $reason = null,
        public ?string $model = null,
        public int $ms = 0,
        public float $tokPerS = 0.0,
        public string $finishReason = 'stop',
        public string $source = 'template',
        public bool $rephrased = false,
    ) {}

    public function withText(string $text): self
    {
        return new self(
            text: $text,
            intent: $this->intent,
            citations: $this->citations,
            degraded: $this->degraded,
            reason: $this->reason,
            model: $this->model,
            ms: $this->ms,
            tokPerS: $this->tokPerS,
            finishReason: $this->finishReason,
            source: $this->source,
            rephrased: $this->rephrased,
        );
    }

    /** @param  array<string, mixed>  $extra */
    public function with(array $extra): self
    {
        return new self(
            text: (string) ($extra['text'] ?? $this->text),
            intent: $extra['intent'] ?? $this->intent,
            citations: $extra['citations'] ?? $this->citations,
            degraded: (bool) ($extra['degraded'] ?? $this->degraded),
            reason: array_key_exists('reason', $extra) ? $extra['reason'] : $this->reason,
            model: array_key_exists('model', $extra) ? $extra['model'] : $this->model,
            ms: (int) ($extra['ms'] ?? $this->ms),
            tokPerS: (float) ($extra['tokPerS'] ?? $this->tokPerS),
            finishReason: (string) ($extra['finishReason'] ?? $this->finishReason),
            source: (string) ($extra['source'] ?? $this->source),
            rephrased: (bool) ($extra['rephrased'] ?? $this->rephrased),
        );
    }

    /**
     * Meta blok pre klienta aj pre `messages.meta`. Kľúče sú zamknutá súčasť
     * odpovede `/api/chat` — P6 na ne drôtuje mikro-label a stav degradácie.
     *
     * @return array<string, mixed>
     */
    public function meta(): array
    {
        return [
            'intent' => $this->intent->name,
            'intent_source' => $this->intent->source,
            'answer_source' => $this->source,
            'degraded' => $this->degraded,
            'reason' => $this->reason,
            'model' => $this->model,
            'ms' => $this->ms,
            'tok_per_s' => round($this->tokPerS, 1),
            'finish_reason' => $this->finishReason,
            'rephrased' => $this->rephrased,
        ];
    }
}
