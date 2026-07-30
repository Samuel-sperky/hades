<?php

namespace App\Llm;

/**
 * SKELETON — implementuje A3 (balík P5).
 *
 * ZOSTÁVA V KÓDE, ALE JE VYPNUTÝ A NEPOVINNÝ (rozhodnutie z 04-ODPOVEDE-ZAZNAM:
 * chat nesmie závisieť od plateného API). Prázdny ANTHROPIC_API_KEY NIE JE chyba —
 * nesmie generovať warning ani zápis do logu. Keď si používateľ kľúč doplní,
 * provider sa zapne v config/llm.php bez zmeny kódu.
 *
 * Kľúč sa NIKDY nesmie dostať do logu, výnimky, odpovede ani cache kľúča.
 */
final class AnthropicProvider implements ChatProvider
{
    public function __construct(
        private readonly ?string $apiKey,
        private readonly string $model,
    ) {}

    /** Prázdny kľúč = provider je len nezapnutý, nie pokazený. */
    public function configured(): bool
    {
        return is_string($this->apiKey) && $this->apiKey !== '';
    }

    public function chat(array $messages, ChatOptions $opts): ChatResult
    {
        return ChatResult::failed($opts->model ?? $this->model, 'AnthropicProvider je vypnutý');
    }

    public function stream(array $messages, ChatOptions $opts, callable $onDelta): ChatResult
    {
        return ChatResult::failed($opts->model ?? $this->model, 'AnthropicProvider je vypnutý');
    }

    public function embed(array $texts, EmbedOptions $opts): array
    {
        return [];
    }

    public function health(): ProviderHealth
    {
        return ProviderHealth::down($this->configured() ? 'AnthropicProvider je vypnutý' : null);
    }

    public function name(): string
    {
        return 'anthropic';
    }
}
