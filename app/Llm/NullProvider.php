<?php

namespace App\Llm;

/**
 * Provider pre stav „žiadny LLM". NIE JE to skeleton — je hotový a je to
 * poistka celého sprintu: keď Ollama nebeží (alebo je LLM vypnutý v configu),
 * ProviderFactory vráti tento provider a appka funguje ďalej. Volajúci vidí
 * finishReason 'error' a použije deterministický fallback (rozhodnutie #104/#112).
 *
 * Vlastník: A3 (P5). Nemá dôvod sa meniť.
 */
final class NullProvider implements ChatProvider
{
    public function __construct(private readonly string $reason = 'lokálny model nie je dostupný') {}

    public function chat(array $messages, ChatOptions $opts): ChatResult
    {
        return ChatResult::failed($opts->model ?? 'none', $this->reason);
    }

    public function stream(array $messages, ChatOptions $opts, callable $onDelta): ChatResult
    {
        return ChatResult::failed($opts->model ?? 'none', $this->reason);
    }

    public function embed(array $texts, EmbedOptions $opts): array
    {
        // Prázdny list = „embedding nie je dostupný". Vektorová vetva recallu (P1)
        // sa musí vynechať BEZ chyby a bez logovania.
        return [];
    }

    public function health(): ProviderHealth
    {
        return ProviderHealth::down($this->reason);
    }

    public function name(): string
    {
        return 'null';
    }
}
