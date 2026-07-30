<?php

namespace App\Services\Maintenance\Rewire;

use App\Models\Edge;
use App\Models\Node;
use Illuminate\Support\Collection;

/**
 * A4 — cross-project cez skill: pre session záznamy doplní chýbajúce skill_mention
 * synapsie (zdieľané skilly sú nepriamym mostom medzi projektmi).
 *
 * Skill je zmienený, ak sa distinktívne tokeny jeho labelu (>= 4 znaky) prekrývajú
 * s tokenmi textu (meta.prompts + meta.final): >= 2 zhody, alebo jednoslovný
 * proper-noun skill (MariaDB, Figma) plne prítomný. Zhoda je tokenizovaná rovnako
 * ako labely — doslovný výskyt viacslovnej frázy sa v texte nikdy netrafí.
 *
 * Nová hrana: kind skill_mention, strop MAX_NEW_MENTIONS na záznam (density guard,
 * parita s ingestom), a strop je TOTAL — ráta aj existujúce skill_mention hrany,
 * aby opakovaný beh nedopĺňal ďalších 5 donekonečna. Existujúca slabšia hrana
 * (co_activation / similarity) sa POVÝŠI bez stropu (nezvyšuje hustotu grafu, len
 * opravuje sémantiku). Hrana, ktorá už je skill_mention/manual, sa nechá tak.
 *
 * Prevzaté 1:1 z MindRewire::verifySkillMentions().
 */
class A4SkillMentions
{
    /** Strop nových skill_mention hrán na jeden session záznam (parita s ingestom). */
    public const MAX_NEW_MENTIONS = 5;

    /**
     * @param  Collection<int, Node>  $skills
     * @return array{new: int, promoted: int}
     */
    public function perNode(Node $node, Collection $skills, RewireContext $ctx): array
    {
        $meta = is_array($node->meta) ? $node->meta : [];
        $prompts = array_filter((array) ($meta['prompts'] ?? []), 'is_string');
        $raw = implode(' ', $prompts).' '.(string) ($meta['final'] ?? '');
        if (trim($raw) === '') {
            return ['new' => 0, 'promoted' => 0];
        }

        // tokeny textu — rovnaká tokenizácia (folding + stopslová) ako pri labeloch
        $textSet = array_flip(array_keys($ctx->similarity->tokenize($raw)));
        if ($textSet === []) {
            return ['new' => 0, 'promoted' => 0];
        }

        // aktuálne hrany uzla aj s ich kind — rozlišujeme nový link vs. povýšenie
        $edgeKinds = $this->edgeKinds($node);

        $existingMentions = count(array_filter($edgeKinds, fn ($k) => $k === 'skill_mention'));
        $budget = max(0, self::MAX_NEW_MENTIONS - $existingMentions);

        $new = 0;
        $promoted = 0;

        foreach ($skills as $skill) {
            if ($skill->id === $node->id) {
                continue;
            }

            $labelTokens = $ctx->labelTokens((string) $skill->label, 4);
            if ($labelTokens === []) {
                continue;
            }

            $matched = array_values(array_filter($labelTokens, fn ($t) => isset($textSet[$t])));
            $mention = count($matched) >= 2
                || (count($labelTokens) <= 1 && count($matched) >= 1 && mb_strlen($matched[0]) >= 5);
            if (! $mention) {
                continue;
            }

            $existingKind = $edgeKinds[$skill->id] ?? null;

            if ($existingKind === null) {
                if ($new >= $budget) {
                    continue;
                }
                $ctx->mind->connect($node, $skill, 'skill_mention', true);
                $edgeKinds[$skill->id] = 'skill_mention';
                $new++;

                continue;
            }

            // povýš len slabšie väzby; skill_mention/manual sa nechajú tak, aby
            // opakovaný beh neinkrementoval váhu
            if (in_array($existingKind, ['similarity', 'co_activation'], true)) {
                $ctx->mind->connect($node, $skill, 'skill_mention', true);
                $edgeKinds[$skill->id] = 'skill_mention';
                $promoted++;
            }
        }

        return ['new' => $new, 'promoted' => $promoted];
    }

    /**
     * Mapa id-suseda => kind hrany pre daný uzol (obojsmerne).
     *
     * @return array<int, string>
     */
    private function edgeKinds(Node $node): array
    {
        $map = [];
        $edges = Edge::query()
            ->where('source_id', $node->id)
            ->orWhere('target_id', $node->id)
            ->get(['source_id', 'target_id', 'kind']);

        foreach ($edges as $e) {
            $other = $e->source_id === $node->id ? $e->target_id : $e->source_id;
            $map[$other] = $e->kind;
        }

        return $map;
    }
}
