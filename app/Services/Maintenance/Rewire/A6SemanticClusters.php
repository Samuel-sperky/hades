<?php

namespace App\Services\Maintenance\Rewire;

use App\Models\Node;

/**
 * A6 — sémantické klastre hviezdicou. Doménové rodiny, ktoré zdieľajú len JEDEN
 * silný tag token (celá e-shop rodina má spoločné iba 'eshop', preto ich A5
 * s prahom 2 tokenov aj seed v rámci oddelenia minie), sa zviažu do čitateľnej
 * hviezdy okolo huba. Plus explicitný most medzi hubmi príbuzných klastrov
 * (pricing ↔ eshop). Lineárny počet hrán (n-1 na klaster), nie hairball.
 *
 * Prevzaté 1:1 z MindRewire::bridgeSemanticClusters() vrátane definícií klastrov.
 */
class A6SemanticClusters
{
    /**
     * 'tag' = kanonizovaný token labelu, ktorý definuje doménovú rodinu;
     * 'hub' = zoznam hint tokenov na výber stredu hviezdy (agregačný / „mapa /
     * ekosystém / systém" uzol). Hviezda vznikne len od 3 členov (dvojicu už
     * zvládne A5). Tag tokeny musia byť v kanonickej podobe (pozri
     * SimilarityService::$canon — napr. e-commerce/eshop → 'eshop').
     */
    public const CLUSTERS = [
        ['tag' => 'eshop', 'hub' => ['ecosystem', 'map']],
        ['tag' => 'pricing', 'hub' => ['stock', 'model']],
        ['tag' => 'backup', 'hub' => ['rotation', 'mariadb']],
        ['tag' => 'banner', 'hub' => ['studio', 'render']],
        // reklamná rodina naprieč oddeleniami: ADS-HIERARCHY sprinty/adaptéry
        // (dept null/31) + platformové skilly Google/Meta/LinkedIn (dept 40) —
        // spoločný kanonický tag 'ads', hub = agregačný ADS-HIERARCHY uzol.
        ['tag' => 'ads', 'hub' => ['hierarchy']],
        // SEO/analytics rodina: audit + kanál-mix skill + sprint (dept 4/40/31).
        ['tag' => 'seo', 'hub' => ['analytics', 'email']],
    ];

    /** Explicitné mosty medzi hubmi príbuzných klastrov (tag ↔ tag). */
    public const CLUSTER_LINKS = [
        ['pricing', 'eshop'],
        // reklama a jej výkonnostné meranie patria k sebe (hub ↔ hub)
        ['ads', 'seo'],
    ];

    public function run(RewireContext $ctx): int
    {
        $nodes = Node::query()
            ->whereIn('type', ['skill', 'project', 'memory'])
            ->orderBy('id')
            ->get(['id', 'label', 'type', 'strength']);

        // kanonizované tokeny labelu (bez dĺžkového filtra — tag je kanonický term)
        $tokens = [];
        foreach ($nodes as $n) {
            $tokens[$n->id] = $ctx->labelTokens((string) $n->label);
        }

        $ctx->links->load();

        $created = 0;
        $hubs = []; // tag => hub Node (pre cross-cluster mosty)

        foreach (self::CLUSTERS as $cluster) {
            $tag = $cluster['tag'];
            $members = $nodes->filter(fn (Node $n) => in_array($tag, $tokens[$n->id], true))->values();

            // dvojicu spoľahlivo pokryje A5 (2 zdieľané tokeny) — hviezda má zmysel
            // až od 3 členov, inak by hub bol umelý
            if ($members->count() < 3) {
                continue;
            }

            $hub = $ctx->hubs->pick($members, $tokens, $cluster['hub']);
            $hubs[$tag] = $hub;

            foreach ($members as $member) {
                if ($member->id === $hub->id) {
                    continue;
                }
                $created += $ctx->links->linkIfNew($hub, $member);
            }
        }

        // mosty medzi hubmi príbuzných klastrov (pricing ↔ eshop atď.)
        foreach (self::CLUSTER_LINKS as [$tagA, $tagB]) {
            if (isset($hubs[$tagA], $hubs[$tagB])) {
                $created += $ctx->links->linkIfNew($hubs[$tagA], $hubs[$tagB]);
            }
        }

        $ctx->budget->addPairs($nodes->count());

        return $created;
    }
}
