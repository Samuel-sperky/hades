<?php

namespace App\Services\Llm;

/**
 * Jeden ťah modelu, znormalizovaný — čokoľvek, čo agentová smyčka o odpovedi
 * potrebuje vedieť, bez ohľadu na poskytovateľa.
 *
 * `stopReason` je zámerne v jednom slovníku pre oba poskytovateľov
 * (`end_turn` / `tool_use` / `max_tokens` / `stop_sequence`). Anthropic ho tak
 * posiela sám; Ollama má `done_reason: "stop"` aj vtedy, keď zavolala tooly,
 * takže smyčka by musela pozerať na dve rôzne veci naraz. Prekladá sa v
 * {@see OllamaStreamParser}.
 *
 * `durationMs` je celý ťah, teda aj to, čo na CPU stojí najviac — nahranie
 * modelu do RAM (namerané: 9,2 s z 10,8 s ťahu na qwen3:1.7b po studenom
 * starte). Preto je tu zvlášť `evalDurationMs`, čas samotného generovania:
 * tokeny za sekundu počítané z celého ťahu by po studenom starte hlásili
 * desatinu skutočnej rýchlosti modelu.
 */
final readonly class LlmResponse
{
    public const STOP_END_TURN = 'end_turn';

    public const STOP_TOOL_USE = 'tool_use';

    public const STOP_MAX_TOKENS = 'max_tokens';

    public const STOP_STOP_SEQUENCE = 'stop_sequence';

    /**
     * @param  list<LlmToolCall>  $toolCalls
     */
    public function __construct(
        public string $text = '',
        public array $toolCalls = [],
        public string $stopReason = self::STOP_END_TURN,
        public int $tokensIn = 0,
        public int $tokensOut = 0,
        public int $durationMs = 0,
        public string $model = '',
        public ?int $evalDurationMs = null,
    ) {}

    public function hasToolCalls(): bool
    {
        return $this->toolCalls !== [];
    }

    /**
     * Tokeny za sekundu na zobrazenie v konzole. `null` znamená „nemám z čoho
     * počítať" — nie nulu, tú by UI vykreslilo ako nameraných 0 tok/s.
     */
    public function tokensPerSecond(): ?float
    {
        $ms = $this->evalDurationMs ?? $this->durationMs;

        if ($ms <= 0 || $this->tokensOut <= 0) {
            return null;
        }

        return round($this->tokensOut / ($ms / 1000), 2);
    }
}
