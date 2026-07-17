<?php

namespace App\Console\Commands;

use App\Models\Edge;
use App\Models\Node;
use App\Services\MindService;
use App\Services\SimilarityService;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;

/**
 * A3 — backfill similarity synapsií naprieč celou sieťou (TF-IDF kosínus).
 * Idempotentné: prepája len páry, ktoré ešte hranu nemajú. Prah 0.20.
 *
 * A4 — cross-project cez skill: pre session záznamy doplní chýbajúce
 * skill_mention synapsie (ich zdieľané skilly sú nepriamym mostom medzi
 * projektmi). Text sa berie z uloženého meta (prompts + final).
 */
class MindRewire extends Command
{
    protected $signature = 'mind:rewire';

    protected $description = 'Backfill: doplní chýbajúce similarity a skill_mention synapsie medzi podobnými uzlami';

    public function handle(SimilarityService $similarity, MindService $mind): int
    {
        $nodes = Node::query()->get();
        $similarity->warmCorpus($nodes);

        $skills = Node::where('type', 'skill')->get(['id', 'label']);

        $simCreated = 0;
        $skillCreated = 0;
        $checked = 0;

        foreach ($nodes as $node) {
            if ($node->type === 'core') {
                continue;
            }
            $checked++;

            // aktuálne prepojené uzly (čerstvo z DB — v tomto behu už mohli pribudnúť)
            $linkedIds = $this->linkedIds($node);

            $isSession = $node->type === 'memory' && $node->source === 'session';
            $ownProject = (string) ($node->meta['project'] ?? '');

            $filter = function (Node $cand) use ($node, $linkedIds, $isSession, $ownProject) {
                if ($cand->id === $node->id || $cand->type === 'core') {
                    return false;
                }
                if ($linkedIds->has($cand->id)) {
                    return false;
                }
                // A4: dva session záznamy rôznych projektov sa priamo nespájajú
                if ($isSession && $cand->type === 'memory' && $cand->source === 'session') {
                    if ((string) ($cand->meta['project'] ?? '') !== $ownProject) {
                        return false;
                    }
                }

                return true;
            };

            foreach ($similarity->topSimilar($node, 3, 0.20, $filter) as $hit) {
                $other = Node::find($hit['node_id']);
                if (! $other) {
                    continue;
                }
                $mind->connect($node, $other, 'similarity', true, 0.5);
                $simCreated++;
            }

            // A4: over/doplň skill_mention synapsie pre session záznamy
            if ($isSession) {
                $skillCreated += $this->verifySkillMentions($node, $skills, $mind);
            }
        }

        $this->info("Rewire: {$checked} uzlov · {$simCreated} similarity · {$skillCreated} skill_mention synapsií.");

        return self::SUCCESS;
    }

    /** Množina id uzlov, s ktorými má $node hranu (bez seba). */
    protected function linkedIds(Node $node): Collection
    {
        return Edge::query()
            ->where('source_id', $node->id)
            ->orWhere('target_id', $node->id)
            ->get(['source_id', 'target_id'])
            ->flatMap(fn (Edge $e) => [$e->source_id, $e->target_id])
            ->reject(fn ($id) => $id === $node->id)
            ->unique()
            ->flip();
    }

    /**
     * Doplní chýbajúce skill_mention hrany: skill spomenutý ako celé slovo v
     * uloženom meta (prompts + final) sa prepojí, ak ešte prepojený nie je.
     * Max 5 na záznam (rovnaký strop ako ingest).
     *
     * @param  Collection<int, Node>  $skills
     */
    protected function verifySkillMentions(Node $node, Collection $skills, MindService $mind): int
    {
        $meta = is_array($node->meta) ? $node->meta : [];
        $prompts = array_filter((array) ($meta['prompts'] ?? []), 'is_string');
        $text = mb_strtolower(implode(' ', $prompts).' '.(string) ($meta['final'] ?? ''));
        if (trim($text) === '') {
            return 0;
        }

        $linkedIds = $this->linkedIds($node);
        $created = 0;

        foreach ($skills as $skill) {
            if ($created >= 5) {
                break;
            }
            if ($skill->id === $node->id || $linkedIds->has($skill->id) || mb_strlen($skill->label) < 4) {
                continue;
            }

            $needles = [mb_strtolower($skill->label)];
            $bare = trim(mb_strtolower(preg_replace('/\s*\([^)]*\)\s*$/u', '', $skill->label)));
            if ($bare !== '' && $bare !== $needles[0] && mb_strlen($bare) >= 4) {
                $needles[] = $bare;
            }

            $hit = false;
            foreach ($needles as $needle) {
                // celé slová — "git" sa nesmie trafiť v "digital"
                $pattern = '/(?<![\p{L}\p{N}])'.preg_quote($needle, '/').'(?![\p{L}\p{N}])/ui';
                if (preg_match($pattern, $text)) {
                    $hit = true;
                    break;
                }
            }
            if (! $hit) {
                continue;
            }

            $mind->connect($node, $skill, 'skill_mention', true);
            $created++;
        }

        return $created;
    }
}
