<?php

namespace App\Console\Commands;

use App\Events\MindPulse;
use App\Models\Edge;
use App\Models\Node;
use App\Services\SimilarityService;
use Illuminate\Console\Command;

/**
 * A10 — prerezanie koincidenčného hairballu. Jednorazové co-aktivačné synapsie
 * (kind co_activation, weight <= 1 — vznikli spoločnou aktivitou v jednej session
 * a už sa nikdy neposilnili) často spájajú uzly, ktoré spolu boli len náhodou,
 * bez sémantickej príbuznosti. Pre každú takú hranu spočíta TF-IDF kosínus jej
 * dvoch koncov; ak je pod prahom SIM_THRESHOLD, hrana je koincidencia a zmaže sa
 * (broadcast edge.deleted). Sémanticky príbuzné co-aktivácie (skóre >= prah)
 * ostávajú — tie nesú reálny vzťah, len vznikli cez session, nie cez similarity.
 *
 * Chirurgické a idempotentné: posilnené (weight > 1) co-aktivácie sa nedotknú,
 * rovnako ani manual, skill_mention či similarity hrany. Mazanie po jednej + pulz,
 * transakcia nie je nutná — každé zmazanie je nezávislé a výpadok v strede nechá
 * konzistentný medzistav (žiadny čiastočný zápis na jednej hrane).
 */
class MindPruneCoactivation extends Command
{
    /**
     * Prah TF-IDF kosínusovej podobnosti koncov hrany. Pod ním je jednorazová
     * co-aktivácia považovaná za koincidenčnú (uzly spolu boli v session len
     * náhodou). Zámerne nízky — cieľom je odstrániť len zjavný šum, nie
     * agresívne rezať slabo príbuzné páry.
     */
    protected const SIM_THRESHOLD = 0.08;

    protected $signature = 'mind:prune-coactivation';

    protected $description = 'Prereže koincidenčné jednorazové co-aktivačné synapsie (weight <= 1) s podobnosťou koncov pod prahom';

    public function handle(SimilarityService $similarity): int
    {
        // rovnako ako mind:rewire: predpočítaj IDF/korpus, aby score() vážil
        // termy poriadnou IDF (bez warmu by boli všetky IDF neutrálne = 1.0)
        $similarity->warmCorpus(Node::query()->get());

        // len jednorazové, neposilnené co-aktivácie — posilnené (weight > 1)
        // nesú opakovaný signál a nechávajú sa tak
        $edges = Edge::query()
            ->where('kind', 'co_activation')
            ->where('weight', '<=', 1)
            ->get();

        $pruned = 0;
        $kept = 0;

        foreach ($edges as $edge) {
            $source = Node::find($edge->source_id);
            $target = Node::find($edge->target_id);

            // osirelý koniec (pri FK cascade by nemal nastať) — bezpečne ponechaj
            if (! $source || ! $target) {
                $kept++;

                continue;
            }

            $score = $similarity->score($source, $target);

            if ($score < self::SIM_THRESHOLD) {
                $id = $edge->id;
                $edge->delete();
                MindPulse::dispatch('edge.deleted', ['id' => $id]);
                $pruned++;

                continue;
            }

            $kept++;
        }

        $this->info(
            "Prune co-activation: prerezaných {$pruned} · ponechaných {$kept} "
            ."(z {$edges->count()} jednorazových co-aktivácií, prah ".self::SIM_THRESHOLD.')'
        );

        return self::SUCCESS;
    }
}
