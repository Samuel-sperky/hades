<?php

namespace App\Llm;

use Illuminate\Container\Container;
use Illuminate\Contracts\Foundation\Application;

/**
 * Jediné miesto, ktoré rozhoduje, KTORÝ provider sa použije. Vlastník P5.
 *
 * Poradie rozhodovania:
 *   1. provider podstrčený do kontejnera (`ChatProvider::class`) — testy a P11;
 *   2. testovací beh bez podstrčeného providera → NullProvider, aby testový
 *      balík NIKDY nechodil na sieť (a nezávisel od toho, či Ollama beží);
 *   3. `config('llm.enabled') === false` → NullProvider (plne deterministický režim);
 *   4. inak OllamaProvider obalený v RecordingProvideri (telemetria do llm_runs).
 *
 * `AnthropicProvider` sa registruje LEN keď je zapnutý v configu A má kľúč
 * (rozhodnutie #25/#117) — prázdny kľúč nie je chyba a nikde sa nehlási.
 */
final class ProviderFactory
{
    /** @var array<string, mixed> */
    private readonly array $config;

    /**
     * @param  array<string, mixed>|null  $config  obsah config('llm');
     *                                             null = prečítať z configu (kontejner ho vie zložiť sám)
     */
    public function __construct(?array $config = null)
    {
        $this->config = $config ?? (array) config('llm', []);
    }

    /** Provider pre konverzáciu a utility úlohy. */
    public function forChat(): ChatProvider
    {
        if (($bound = $this->boundProvider()) instanceof ChatProvider) {
            return $bound;
        }

        if ($this->runningTests()) {
            return new NullProvider('LLM je v testoch vypnutý (podstrč providera do kontejnera)');
        }

        if (! ($this->config['enabled'] ?? false)) {
            return new NullProvider('LLM je vypnutý (config llm.enabled)');
        }

        if ($this->anthropicUsable()) {
            return new AnthropicProvider(
                apiKey: (string) ($this->config['anthropic']['key'] ?? ''),
                model: (string) ($this->config['anthropic']['model'] ?? ''),
            );
        }

        return new RecordingProvider($this->ollama());
    }

    /** Provider pre embeddingy — bge-m3, iný model než chat (viď config llm.models). */
    public function forEmbed(): ChatProvider
    {
        return $this->forChat();
    }

    /**
     * Silnejší model pre eskaláciu. Dnes je to ten istý runtime — voľbu modelu
     * robí `ChatOptions::$task` ('chat'/'rephrase' → config llm.models.escalation),
     * takže eskalácia nepotrebuje vlastnú instanciu providera.
     */
    public function forEscalation(): ChatProvider
    {
        return $this->forChat();
    }

    private function ollama(): OllamaProvider
    {
        /** @var array<string, string> $models */
        $models = (array) ($this->config['models'] ?? []);

        return new OllamaProvider(
            baseUrl: (string) ($this->config['ollama']['url'] ?? ''),
            chatModel: (string) ($models['router'] ?? ''),
            embedModel: (string) ($models['embed'] ?? ''),
            models: $models,
            tasks: (array) ($this->config['tasks'] ?? []),
            timeouts: (array) ($this->config['timeouts'] ?? []),
            keepAlive: (string) ($this->config['ollama']['keep_alive'] ?? '30m'),
            healthTtl: (int) ($this->config['ollama']['health_ttl'] ?? 15),
        );
    }

    /** Anthropic je vypnutý by default; bez kľúča sa NEregistruje a nič nehlási. */
    private function anthropicUsable(): bool
    {
        return (bool) ($this->config['anthropic']['enabled'] ?? false)
            && trim((string) ($this->config['anthropic']['key'] ?? '')) !== '';
    }

    private function boundProvider(): ?ChatProvider
    {
        $app = $this->app();

        if ($app === null || ! $app->bound(ChatProvider::class)) {
            return null;
        }

        $resolved = $app->make(ChatProvider::class);

        return $resolved instanceof ChatProvider ? $resolved : null;
    }

    private function runningTests(): bool
    {
        return $this->app()?->runningUnitTests() ?? false;
    }

    private function app(): ?Application
    {
        $container = Container::getInstance();

        return $container instanceof Application ? $container : null;
    }
}
