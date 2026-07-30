<?php

namespace App\Llm;

/**
 * Jediné miesto, ktoré rozhoduje, KTORÝ provider sa použije. Vlastník: A3 (P5).
 *
 * Kým je config('llm.enabled') false (default), vracia NullProvider — teda
 * appka beží v plne deterministickom režime a žiadny nedokončený provider sa
 * neinštancuje. A3 tu doplní výber podľa úlohy (router / eskalácia / embed).
 */
final class ProviderFactory
{
    /** @param  array<string, mixed>  $config  obsah config('llm') */
    public function __construct(private readonly array $config) {}

    /** Provider pre konverzáciu a utility úlohy. */
    public function forChat(): ChatProvider
    {
        if (! ($this->config['enabled'] ?? false)) {
            return new NullProvider('LLM je vypnutý (config llm.enabled)');
        }

        return new OllamaProvider(
            baseUrl: (string) ($this->config['ollama']['url'] ?? ''),
            chatModel: (string) ($this->config['models']['router'] ?? ''),
            embedModel: (string) ($this->config['models']['embed'] ?? ''),
        );
    }

    /** Provider pre embeddingy — môže to byť iný model než chat. */
    public function forEmbed(): ChatProvider
    {
        return $this->forChat();
    }

    /** Silnejší model pre eskaláciu; A3 doplní pravidlá v EscalationPolicy. */
    public function forEscalation(): ChatProvider
    {
        return $this->forChat();
    }
}
