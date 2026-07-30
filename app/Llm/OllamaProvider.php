<?php

namespace App\Llm;

/**
 * SKELETON — implementuje A3 (balík P5).
 *
 * Lokálny Ollama runtime: Qwen3-0.6B Q8_0 ako router, nemotron-mini 4B ako
 * eskalácia, multilingual-e5-small na embeddingy (rozhodnutia #101/#104/#106/#111).
 *
 * Čo MUSÍ platiť po dokončení:
 *   - žiadna metóda nevyhodí výnimku pri nedostupnej Ollame → ChatResult::failed()
 *     resp. ProviderHealth::down()
 *   - timeouty z config('llm.timeouts'): connect 5 s / first-token 90 s /
 *     total 300 s / idle 30 s
 *   - health() sa cachuje krátko, aby /api/chat nepingoval Ollamu pri každom requeste
 *   - do llm_runs sa zapisuje task + model + tok/s per požiadavka
 *   - prompt prechádza SecretScanner (A2) PRED odoslaním
 *
 * Kým nie je implementovaný, ProviderFactory ho nevracia (config('llm.enabled')
 * je default false), takže sa nikdy neinštancuje.
 */
final class OllamaProvider implements ChatProvider
{
    public function __construct(
        private readonly string $baseUrl,
        private readonly string $chatModel,
        private readonly string $embedModel,
    ) {}

    public function chat(array $messages, ChatOptions $opts): ChatResult
    {
        return ChatResult::failed($opts->model ?? $this->chatModel, 'OllamaProvider::chat nie je implementovaný (P5)');
    }

    public function stream(array $messages, ChatOptions $opts, callable $onDelta): ChatResult
    {
        return ChatResult::failed($opts->model ?? $this->chatModel, 'OllamaProvider::stream nie je implementovaný (P5)');
    }

    public function embed(array $texts, EmbedOptions $opts): array
    {
        return [];
    }

    public function health(): ProviderHealth
    {
        return ProviderHealth::down('OllamaProvider nie je implementovaný (P5)');
    }

    public function name(): string
    {
        return 'ollama';
    }
}
