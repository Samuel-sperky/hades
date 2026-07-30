<?php

namespace App\Services\Maintenance\Rewire;

use App\Models\Node;

/**
 * A7 — session/pamäť → jej projekt: memory uzol s meta.project sa priamo zviaže
 * s projektovým uzlom rovnakého názvu (nepriamu co-aktiváciu tým doplní
 * o explicitnú štrukturálnu väzbu záznam → projekt).
 *
 * Prevzaté 1:1 z MindRewire::bridgeSessionsToProjects(). Idempotentné, kind
 * 'similarity'.
 */
class A7SessionProjects
{
    public function run(RewireContext $ctx): int
    {
        $projects = Node::where('type', 'project')->get(['id', 'label']);
        if ($projects->isEmpty()) {
            return 0;
        }

        $byLabel = [];
        foreach ($projects as $project) {
            $byLabel[$this->normalizeKey((string) $project->label)] = $project;
        }

        $ctx->links->load();
        $created = 0;

        $memories = Node::where('type', 'memory')->get(['id', 'label', 'meta']);
        foreach ($memories as $memory) {
            $meta = is_array($memory->meta) ? $memory->meta : [];
            $proj = trim((string) ($meta['project'] ?? ''));
            if ($proj === '') {
                continue;
            }

            $target = $byLabel[$this->normalizeKey($proj)] ?? null;
            if (! $target || $target->id === $memory->id) {
                continue;
            }

            $created += $ctx->links->linkIfNew($memory, $target);
        }

        $ctx->budget->addPairs($memories->count());

        return $created;
    }

    /** Normalizácia názvu na porovnávací kľúč: lowercase, len [a-z0-9]. */
    private function normalizeKey(string $s): string
    {
        return (string) preg_replace('/[^a-z0-9]+/', '', mb_strtolower(trim($s)));
    }
}
