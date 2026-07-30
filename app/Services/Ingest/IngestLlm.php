<?php

namespace App\Services\Ingest;

use App\Llm\ChatOptions;
use App\Llm\ChatProvider;
use App\Llm\ChatResult;
use App\Llm\ProviderFactory;
use Throwable;

/**
 * Jediný most z ingestu k modelu. Drží pravidlo #112 „model navrhne,
 * deterministický kód rozhodne" na úrovni infrastruktúry:
 *
 *  - každá LLM vetva ingestu je za samostatným vypínačom v `config/ingest.php`
 *    a default je VYPNUTÝ → bez zásahu integrátora je chovanie ingestu
 *    bit-identické s dnešným (ingest beží každých 10 minút na živých dátach);
 *  - keď Ollama nebeží, `ChatProvider` vráti `finishReason: 'error'` a `ask()`
 *    vráti null — volajúci použije deterministický fallback. Nikdy sa nehádže
 *    výnimka a nikdy sa nič neloguje ako chyba (rozhodnutie #104/#119);
 *  - provider sa berie z kontejnera, keď je nabindovaný (tak ho testy podstrčia
 *    cez {@see \Tests\Support\FakeProvider}), inak z {@see ProviderFactory},
 *    ktorá pri `llm.enabled=false` vracia NullProvider.
 */
class IngestLlm
{
    public function __construct(
        /** Explicitný provider (testy, dry-run). null = autodetekcia. */
        protected ?ChatProvider $provider = null,
    ) {}

    /** Je konkrétna LLM vetva ingestu zapnutá? Default vždy false. */
    public function enabled(string $flag): bool
    {
        return (bool) config('ingest.'.$flag, false);
    }

    /**
     * Jeden dotaz na model. Vracia výsledok len keď model reálne odpovedal;
     * pri akejkoľvek nedostupnosti alebo chybe vracia null.
     *
     * @param  list<array{role: string, content: string}>  $messages
     */
    public function ask(array $messages, ChatOptions $opts): ?ChatResult
    {
        $provider = $this->resolve();
        if ($provider === null) {
            return null;
        }

        try {
            $result = $provider->chat($messages, $opts);
        } catch (Throwable) {
            // Provider nesmie vyhadzovať (kontrakt #11), ale ingest nesmie padnúť
            // ani keď to niektorá implementácia poruší.
            return null;
        }

        if (! $result->ok() || trim($result->text) === '') {
            return null;
        }

        return $result;
    }

    protected function resolve(): ?ChatProvider
    {
        if ($this->provider !== null) {
            return $this->provider;
        }

        try {
            if (app()->bound(ChatProvider::class)) {
                return app(ChatProvider::class);
            }

            return (new ProviderFactory((array) config('llm', [])))->forChat();
        } catch (Throwable) {
            return null;
        }
    }
}
