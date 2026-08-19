<?php

namespace App\Http\Controllers\Console;

use App\Http\Controllers\Controller;
use App\Services\Llm\LlmProvider;
use App\Services\Llm\ProviderFactory;
use Illuminate\Http\JsonResponse;

/**
 * Ponuka modelov pre prepínač v hlavičke konzoly — `GET /api/console/models`.
 *
 * Zoznam sa NEberie z configu, ale z poskytovateľa: modely sa na tomto stroji
 * doťahujú za chodu (`ollama pull`) aj mažú, takže zadrôtovaný zoznam by ponúkal
 * model, ktorý tu už nie je — a ťah by spadol až po odoslaní správy.
 *
 * Vypisujú sa len DOSTUPNÍ poskytovatelia (`available()`). Anthropic bez API
 * kľúča je nedostupný a jeho modely v ponuke by boli pasca: prepínač by ich
 * ukázal, výber uložil a prvý ťah by skončil chybou o chýbajúcom kľúči.
 *
 * Embedding modely sa filtrujú (§ nižšie). Bez toho ponuka mieša dve triedy
 * modelov, ktoré sa nedajú zameniť: `bge-m3` vie len vektory a na `/api/chat`
 * nevie odpovedať vôbec — jeho výber by vlákno umlčal bez zjavného dôvodu.
 */
class ModelController extends Controller
{
    /**
     * Mená, ktoré nesú embedding, nie konverzáciu. Ollama v `/api/tags`
     * neoznačuje účel modelu nijako, takže rozlíšiť ich vieme len podľa mena —
     * je to heuristika a preto je zámerne úzka: radšej nechať v ponuke jeden
     * model navyše než odfiltrovať ten, na ktorom má vlákno bežať.
     */
    private const EMBEDDING_HINTS = ['embed', 'bge-', 'paraphrase-', 'nomic-'];

    public function index(ProviderFactory $providers): JsonResponse
    {
        $models = [];
        $unavailable = [];

        foreach ($providers->names() as $name) {
            $provider = $providers->make($name);

            if (! $provider->available()) {
                $unavailable[] = $name;

                continue;
            }

            foreach ($this->chatModels($provider) as $id) {
                $models[] = [
                    'id' => $id,
                    'label' => $id,
                    'provider' => $name,
                ];
            }
        }

        return response()->json([
            'models' => $models,
            // Klient tým vie, na čom vlákno pobeží, keď model nemá vybraný —
            // inak by prepínač musel default hádať z prvého prvku zoznamu.
            'default' => [
                'provider' => (string) config('hades.console.provider'),
                'model' => (string) config('hades.console.ollama.model'),
            ],
            'unavailable' => $unavailable,
        ]);
    }

    /**
     * @return list<string>
     */
    private function chatModels(LlmProvider $provider): array
    {
        return array_values(array_filter(
            $provider->models(),
            function (string $id): bool {
                $needle = strtolower($id);

                foreach (self::EMBEDDING_HINTS as $hint) {
                    if (str_contains($needle, $hint)) {
                        return false;
                    }
                }

                return true;
            },
        ));
    }
}
