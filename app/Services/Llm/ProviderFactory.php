<?php

namespace App\Services\Llm;

/**
 * Vydá poskytovateľa podľa mena; default berie z `hades.console.provider`.
 *
 * Prečo trieda a nie `match` v kontroléri: poskytovateľa si vyžiada agentová
 * smyčka, MCP tooly aj chat vo vizualizácii, a rozhodnutie „ktorý model“ má byť
 * na jednom mieste. Neznáme meno je výnimka, nie tichý fallback — dôvod je v
 * {@see UnknownProviderException}.
 *
 * Instancie sa držia: poskytovateľ je bezstavový, ale `available()` a `models()`
 * volajú sieť a jedno vykreslenie konzoly by inak zbytočne sondovalo Ollamu
 * viackrát.
 */
class ProviderFactory
{
    /** @var array<string, class-string<LlmProvider>> */
    protected const PROVIDERS = [
        OllamaProvider::NAME => OllamaProvider::class,
        AnthropicProvider::NAME => AnthropicProvider::class,
    ];

    /** @var array<string, LlmProvider> */
    protected array $resolved = [];

    /**
     * @throws UnknownProviderException
     */
    public function make(?string $name = null): LlmProvider
    {
        $name = strtolower(trim($name ?? (string) config('hades.console.provider', OllamaProvider::NAME)));

        if (! isset(static::PROVIDERS[$name])) {
            throw new UnknownProviderException($name, $this->names());
        }

        return $this->resolved[$name] ??= app(static::PROVIDERS[$name]);
    }

    /**
     * Mená, ktoré {@see self::make()} pozná — pre ponuku v UI a pre text chyby.
     *
     * @return list<string>
     */
    public function names(): array
    {
        return array_keys(static::PROVIDERS);
    }
}
