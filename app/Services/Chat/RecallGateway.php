<?php

namespace App\Services\Chat;

use App\Models\Node;
use App\Services\MindService;
use Illuminate\Support\Collection;
use Throwable;

/**
 * Jediné miesto, ktorým chat siaha na recall. Vlastník P5, konzumuje P1.
 *
 * Prečo medzivrstva: rozhranie #13 (`RecallEngine`) vzniká v balíku P1 súbežne
 * s týmto balíkom. Gateway použije `RecallEngine`, keď v strome existuje, inak
 * dnešný `MindService::recall()`. Chat tak nemusí čakať na P1 a po jeho zlúčení
 * sa nemení ani riadok v chate.
 *
 * Recall zároveň rozsvieti vybavené uzly na canvase — pulz `recall` posiela
 * samotný recall (MindService::recall → MindPulse), preto ho tu neduplikujeme.
 */
final class RecallGateway
{
    public function __construct(private readonly MindService $mind) {}

    /**
     * Vybavené uzly, primáre v poradí relevancie a za nimi susedia.
     *
     * @return Collection<int, Node>
     */
    public function recall(string $query, int $limit = 12, ?string $sessionKey = null): Collection
    {
        $query = trim($query);
        if ($query === '') {
            return collect();
        }

        try {
            if ($engine = $this->engine()) {
                return $this->fromEngine($engine, $query, $limit, $sessionKey);
            }

            return $this->mind->recall($query, $limit, $sessionKey);
        } catch (Throwable) {
            // Recall je podklad odpovede, nie odpoveď — jeho zlyhanie nesmie
            // zhodiť chat. Bez podkladu odpovie šablóna „nič k tomu nemám".
            return collect();
        }
    }

    /** Vyhľadávanie bez zápisu aktivácií — pre `@mention` a slash príkazy. */
    public function search(string $query, int $limit = 12): Collection
    {
        $query = trim($query);
        if ($query === '') {
            return collect();
        }

        try {
            return $this->mind->searchNodes($query, $limit)
                ->map(fn ($row) => is_array($row) ? ($row['node'] ?? null) : $row)
                ->filter(fn ($node) => $node instanceof Node)
                ->values();
        } catch (Throwable) {
            return collect();
        }
    }

    /** @return object|null RecallEngine, keď ho už P1 doručila */
    private function engine(): ?object
    {
        $class = 'App\\Services\\Recall\\RecallEngine';

        if (! class_exists($class)) {
            return null;
        }

        try {
            return app($class);
        } catch (Throwable) {
            return null;
        }
    }

    /**
     * `RecallResult{primaries, neighbours, total}` podľa rozhrania #13.
     *
     * @return Collection<int, Node>
     */
    private function fromEngine(object $engine, string $query, int $limit, ?string $sessionKey): Collection
    {
        /** @var mixed $result */
        $result = $engine->recall($query, $limit, $sessionKey);

        if ($result instanceof Collection) {
            return $result->filter(fn ($n) => $n instanceof Node)->values();
        }

        $primaries = collect(data_get($result, 'primaries', []));
        $neighbours = collect(data_get($result, 'neighbours', []));

        return $primaries->concat($neighbours)
            ->filter(fn ($n) => $n instanceof Node)
            ->values();
    }
}
