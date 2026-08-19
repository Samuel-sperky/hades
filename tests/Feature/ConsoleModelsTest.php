<?php

namespace Tests\Feature;

use App\Services\Llm\AnthropicProvider;
use App\Services\Llm\LlmProvider;
use App\Services\Llm\LlmResponse;
use App\Services\Llm\OllamaProvider;
use Tests\TestCase;

/**
 * `GET /api/console/models` — ponuka pre prepínač modelu v hlavičke konzoly.
 *
 * Poskytovatelia sú fake naviazaní do kontejnera (`ProviderFactory` si ich
 * vytiahne z neho), takže testy nesiahnu na skutočnú Ollamu — inak by sada
 * padala podľa toho, čo má práve tento stroj stiahnuté.
 */
class ConsoleModelsTest extends TestCase
{
    /**
     * Embedding modely nepatria do ponuky: `bge-m3` vie len vektory a na
     * `/api/chat` neodpovie, takže jeho výber by vlákno umlčal bez chyby.
     */
    public function test_embedding_models_are_not_offered(): void
    {
        $this->bindProvider(OllamaProvider::class, OllamaProvider::NAME, true, [
            'qwen3:8b', 'bge-m3:latest', 'paraphrase-multilingual:latest', 'embeddinggemma:latest', 'nomic-embed-text', 'qwen3:4b',
        ]);
        $this->bindProvider(AnthropicProvider::class, AnthropicProvider::NAME, false, []);

        $ids = collect($this->getJson('/api/console/models')->assertOk()->json('models'))
            ->pluck('id')
            ->all();

        $this->assertSame(['qwen3:8b', 'qwen3:4b'], $ids);
    }

    /**
     * Nedostupný poskytovateľ svoje modely neponúka. Anthropic bez kľúča ich
     * vracia z konštanty, takže bez tejto filtrácie by prepínač ukázal Claude
     * modely a prvý ťah by spadol na chýbajúci kľúč.
     */
    public function test_unavailable_provider_is_named_but_offers_nothing(): void
    {
        $this->bindProvider(OllamaProvider::class, OllamaProvider::NAME, true, ['qwen3:8b']);
        $this->bindProvider(AnthropicProvider::class, AnthropicProvider::NAME, false, ['claude-sonnet-5']);

        $data = $this->getJson('/api/console/models')->assertOk()->json();

        $this->assertSame(['ollama'], collect($data['models'])->pluck('provider')->unique()->all());
        $this->assertSame(['anthropic'], $data['unavailable']);
    }

    /** Klient potrebuje vedieť, na čom pobeží vlákno bez vybraného modelu. */
    public function test_default_from_config_is_reported(): void
    {
        config(['hades.console.provider' => 'ollama', 'hades.console.ollama.model' => 'qwen3:8b']);
        $this->bindProvider(OllamaProvider::class, OllamaProvider::NAME, true, ['qwen3:8b']);
        $this->bindProvider(AnthropicProvider::class, AnthropicProvider::NAME, false, []);

        $this->getJson('/api/console/models')
            ->assertOk()
            ->assertJsonPath('default.provider', 'ollama')
            ->assertJsonPath('default.model', 'qwen3:8b');
    }

    /**
     * @param  list<string>  $models
     */
    private function bindProvider(string $class, string $name, bool $available, array $models): void
    {
        $this->app->bind($class, fn () => new class($name, $available, $models) implements LlmProvider
        {
            /** @param  list<string>  $models */
            public function __construct(private string $name, private bool $available, private array $models) {}

            public function name(): string
            {
                return $this->name;
            }

            public function models(): array
            {
                return $this->models;
            }

            public function available(): bool
            {
                return $this->available;
            }

            public function chat(array $messages, array $options = []): LlmResponse
            {
                return new LlmResponse(text: '');
            }

            public function stream(array $messages, array $options, callable $onDelta): LlmResponse
            {
                return new LlmResponse(text: '');
            }
        });
    }
}
