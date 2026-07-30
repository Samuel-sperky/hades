<?php

namespace App\Services\Maintenance\Rewire;

use App\Models\Node;
use Illuminate\Support\Collection;

/**
 * Výber stredu hviezdy (hub) a spoločné hint tokeny agregačných uzlov.
 *
 * Prevzaté 1:1 z MindRewire::pickHub() + konštanty DEPT_HUB_HINTS. Samostatná
 * trieda preto, že hinty číta A8 (vnútro-oddelenské hviezdy) aj A11 (backfill
 * relácie 'part_of') — v monolite to bola konštanta zdieľaná dvoma nesúvisiacimi
 * algoritmami, čo pri delení na triedy inak vedie k duplikátu.
 */
class HubPicker
{
    /**
     * Hint tokeny na výber agregačného / „mapa / ekosystém / systém / architektúra"
     * uzla, ktorý prirodzene zastupuje celé oddelenie. Kanonizované (folding) tvary,
     * pozri SimilarityService.
     */
    public const DEPT_HUB_HINTS = [
        'map', 'ecosystem', 'system', 'hierarchy', 'architecture', 'overview', 'dashboard', 'kit',
    ];

    /**
     * Stred hviezdy: 1) prvý člen (v poradí, v akom prišiel) ktorého tokeny labelu
     * pretnú hub-hinty; 2) inak najsilnejší člen, tie-break najnižšie id.
     *
     * @param  Collection<int, Node>  $members
     * @param  array<int, array<int, string>>  $tokens  id => tokeny labelu
     * @param  array<int, string>  $hubHints
     */
    public function pick(Collection $members, array $tokens, array $hubHints): Node
    {
        foreach ($members as $member) {
            if (array_intersect($hubHints, $tokens[$member->id] ?? [])) {
                return $member;
            }
        }

        $best = null;
        foreach ($members as $member) {
            if ($best === null
                || (float) $member->strength > (float) $best->strength
                || ((float) $member->strength === (float) $best->strength && $member->id < $best->id)) {
                $best = $member;
            }
        }

        return $best;
    }
}
