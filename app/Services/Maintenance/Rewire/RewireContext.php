<?php

namespace App\Services\Maintenance\Rewire;

use App\Services\MindService;
use App\Services\SimilarityService;

/**
 * Zdieľané závislosti jedného rewire behu. Namiesto toho, aby si každý algoritmus
 * ťahal MindService, SimilarityService, snapshot hrán a rozpočet vlastnou cestou,
 * dostane jeden kontext.
 */
class RewireContext
{
    public function __construct(
        public readonly MindService $mind,
        public readonly SimilarityService $similarity,
        public readonly LinkRegistry $links,
        public readonly HubPicker $hubs,
        public readonly RewireBudget $budget,
    ) {}

    /**
     * Distinktívne tokeny labelu (>= $minLength znakov). Rovnaká tokenizácia ako
     * pri porovnávaní uzlov — doslovný výskyt viacslovnej frázy sa v texte netrafí.
     *
     * @return list<string>
     */
    public function labelTokens(string $label, int $minLength = 0): array
    {
        $tokens = array_keys($this->similarity->tokenize($label));
        if ($minLength <= 0) {
            return array_values($tokens);
        }

        return array_values(array_filter($tokens, fn ($t) => mb_strlen((string) $t) >= $minLength));
    }
}
