<?php

namespace App\Services\Ingest;

use App\Events\MindPulse;
use App\Models\Activation;
use App\Models\Area;
use App\Models\Edge;
use App\Models\Node;
use App\Services\MindService;
use App\Services\SimilarityService;
use Illuminate\Support\Str;

/**
 * LINKER — všetko, čo po zápise záznamu vzniká v sieti: projektový uzol a hrana
 * naň, hrany na spomenuté skilly, posilnenie reálne použitých skillov a
 * automatické prepojenie na podobné uzly.
 *
 * Vyčlenené z {@see \App\Services\TranscriptIngestService} (W2/P3) bez zmeny
 * chovania — stropy (max 5 hrán, top-3 podobných), prahy (0.18) aj pravidlo A4
 * sú prenesené verbatim.
 */
class SessionLinker
{
    /** Max hrán na skilly z jedného záznamu. */
    protected const MAX_SKILL_LINKS = 5;

    /** Max posilnených skillov z jedného záznamu. */
    protected const MAX_STRENGTHENED = 5;

    public function __construct(
        protected MindService $mind = new MindService(),
        protected SimilarityService $similarity = new SimilarityService(),
    ) {}

    /**
     * Auto project uzol: firstOrCreate 'project:<slug>' a prepoj záznam naň.
     * Váha hrany rastie len keď bol session uzol v tomto behu vytvorený —
     * opakovaný ingest nie je nová aktivita.
     */
    public function linkToProject(Node $node, ?string $project, ?Area $area, bool $created): void
    {
        $project = trim((string) $project);
        if ($project === '') {
            return;
        }

        $projectNode = Node::firstOrCreate(
            ['external_key' => 'project:'.Str::slug($project)],
            [
                'type' => 'project',
                'source' => null,
                'label' => $project,
                'area_id' => $area?->id,
                'department_id' => null,
                'strength' => 2,
                'last_activated_at' => now(),
            ],
        );

        if ($projectNode->id === $node->id) {
            return;
        }

        [$s, $t] = $node->id < $projectNode->id ? [$node->id, $projectNode->id] : [$projectNode->id, $node->id];
        $edge = Edge::firstOrCreate(
            ['source_id' => $s, 'target_id' => $t],
            // príslušnosť záznamu k projektu je automatická co-aktivačná synapsia
            ['weight' => 1, 'kind' => 'co_activation', 'auto' => true, 'last_activated_at' => now()],
        );

        if ($created && ! $edge->wasRecentlyCreated) {
            $edge->increment('weight');
            $edge->forceFill(['last_activated_at' => now()])->save();
        }
    }

    /**
     * Prepojenie na skill uzly, ktorých label sa spomína v promptoch/finálnom texte.
     * Max 5 prepojení na záznam.
     *
     * @param  array<string, mixed>  $rec
     */
    public function linkSkillMentions(Node $node, array $rec): void
    {
        $text = mb_strtolower(implode(' ', $rec['prompts']).' '.(string) $rec['final']);
        if (trim($text) === '') {
            return;
        }

        $linked = 0;
        $skills = Node::where('type', 'skill')->get(['id', 'label']);

        foreach ($skills as $skill) {
            if ($linked >= self::MAX_SKILL_LINKS) {
                break;
            }
            if (mb_strlen($skill->label) < 4) {
                continue;
            }

            $needles = [mb_strtolower($skill->label)];
            // "SEO analysis (Ahrefs)" → skús aj "seo analysis"
            $bare = trim(mb_strtolower(preg_replace('/\s*\([^)]*\)\s*$/u', '', $skill->label)));
            if ($bare !== '' && $bare !== $needles[0] && mb_strlen($bare) >= 4) {
                $needles[] = $bare;
            }

            $hit = false;
            foreach ($needles as $needle) {
                if (preg_match($this->wholeWordPattern($needle), $text)) {
                    $hit = true;
                    break;
                }
            }
            if (! $hit || $skill->id === $node->id) {
                continue;
            }

            // zmienka skillu v zázname → automatická skill_mention synapsia
            $this->mind->connect($node, $skill, 'skill_mention', true);
            $linked++;
        }
    }

    /**
     * E5: skutočné použitie skillu — skill node sa spomína ako tool v meta.tools
     * alebo ako celé slovo v promptoch → posilni ho (strength + last_activated_at),
     * aby reálna práca so skillom bola v sieti vidieť. Beží len pri vytvorení záznamu.
     *
     * @param  array<string, mixed>  $rec
     */
    public function strengthenUsedSkills(array $rec, ?string $sessionKey): void
    {
        $tools = array_map('mb_strtolower', array_keys((array) ($rec['tools'] ?? [])));
        $text = mb_strtolower(implode(' ', $rec['prompts']).' '.(string) $rec['final']);
        if ($tools === [] && trim($text) === '') {
            return;
        }

        $strengthened = 0;
        foreach (Node::where('type', 'skill')->get(['id', 'label', 'strength', 'last_activated_at']) as $skill) {
            if ($strengthened >= self::MAX_STRENGTHENED) {
                break;
            }

            $label = mb_strtolower($skill->label);
            $bare = trim(mb_strtolower(preg_replace('/\s*\([^)]*\)\s*$/u', '', $skill->label)));
            $needles = array_values(array_unique(array_filter([$label, $bare], fn ($n) => mb_strlen((string) $n) >= 4)));

            // priama zhoda s názvom použitého toolu (Skill/playbook)
            $used = in_array($label, $tools, true) || ($bare !== '' && in_array($bare, $tools, true));

            // alebo zmienka ako celé slovo v promptoch/finále
            if (! $used) {
                foreach ($needles as $needle) {
                    if (preg_match($this->wholeWordPattern($needle), $text)) {
                        $used = true;
                        break;
                    }
                }
            }

            if (! $used) {
                continue;
            }

            $skill->increment('strength');
            $skill->forceFill(['last_activated_at' => now()])->save();
            Activation::record($skill, 'skill-used', $sessionKey);
            MindPulse::dispatch('node.activated', [
                'node_id' => $skill->id,
                'strength' => (float) $skill->strength,
            ]);
            $strengthened++;
        }
    }

    /**
     * A2: po vytvorení uzla ho automaticky prepoj na top-3 najpodobnejšie uzly
     * (TF-IDF kosínus, prah 0.18). Vylúč core uzly a už prepojené uzly.
     * A4: dva session záznamy RÔZNYCH projektov sa priamo neprepájajú
     * (spájajú sa nepriamo cez zdieľané skill uzly). Similarity hrana má váhu 0.5.
     */
    public function autoLinkSimilar(Node $node): void
    {
        // uzly už prepojené s týmto záznamom (projekt + skilly) sa vylúčia
        $linkedIds = Edge::query()
            ->where('source_id', $node->id)
            ->orWhere('target_id', $node->id)
            ->get(['source_id', 'target_id'])
            ->flatMap(fn (Edge $e) => [$e->source_id, $e->target_id])
            ->reject(fn ($id) => $id === $node->id)
            ->unique()
            ->flip();

        $isSession = $node->type === 'memory' && $node->source === 'session';
        $ownProject = (string) ($node->meta['project'] ?? '');

        $filter = function (Node $cand) use ($node, $linkedIds, $isSession, $ownProject) {
            if ($cand->id === $node->id) {
                return false;
            }
            if ($cand->type === 'core') {
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

        // korpus sa nahreje čerstvo — musí obsahovať aj práve vytvorený uzol
        $this->similarity->warmCorpus(Node::query()->get());
        $top = $this->similarity->topSimilar($node, 3, 0.18, $filter);

        foreach ($top as $hit) {
            $other = Node::find($hit['node_id']);
            if (! $other) {
                continue;
            }
            // odvodená synapsia s polovičnou počiatočnou váhou
            $this->mind->connect($node, $other, 'similarity', true, 0.5);
        }
    }

    /** Zhoda len na hraniciach slova — "git" sa nesmie trafiť v "digital". */
    protected function wholeWordPattern(string $needle): string
    {
        return '/(?<![\p{L}\p{N}])'.preg_quote($needle, '/').'(?![\p{L}\p{N}])/ui';
    }
}
