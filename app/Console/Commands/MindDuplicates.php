<?php

namespace App\Console\Commands;

use App\Models\MergeCandidate;
use App\Models\Node;
use App\Services\MindService;
use Illuminate\Console\Command;

/**
 * A6 — prehľad a rozhodovanie o návrhoch na zlúčenie.
 *
 * Zlučovanie je odteraz vždy ľudské rozhodnutie. Tento príkaz je to miesto, kde
 * sa robí: bez argumentov len vypíše frontu, s --merge alebo --reject vybaví
 * konkrétny návrh.
 *
 *   php artisan mind:duplicates
 *   php artisan mind:duplicates --merge=12          (slabší uzol sa zlúči do silnejšieho)
 *   php artisan mind:duplicates --merge=12 --keep=340  (víťaza urči sám)
 *   php artisan mind:duplicates --reject=12
 */
class MindDuplicates extends Command
{
    protected $signature = 'mind:duplicates
        {--scan : Prehľadá existujúce uzly a doplní návrhy z kolízií slugov}
        {--merge= : ID návrhu, ktorý sa má zlúčiť}
        {--keep= : ID uzla, ktorý má pri zlúčení prežiť (inak vyhráva silnejší)}
        {--reject= : ID návrhu, ktorý sa má zamietnuť}
        {--all : Vypísať aj už rozhodnuté návrhy}';

    protected $description = 'Vypíše frontu návrhov na zlúčenie duplicít a umožní ich potvrdiť alebo zamietnuť';

    public function handle(MindService $mind): int
    {
        if ($id = $this->option('reject')) {
            return $this->reject((int) $id);
        }

        if ($id = $this->option('merge')) {
            return $this->merge($mind, (int) $id);
        }

        if ($this->option('scan')) {
            $this->scan($mind);
        }

        return $this->listCandidates();
    }

    /**
     * Jednorazový záchyt duplicít, ktoré už v sieti sú. mind_learn plní frontu
     * len pri novom zápise a mind:automerge porovnáva iba v rámci rovnakého
     * typu — kolízie slugov naprieč typmi by inak nikto nenašiel. Práve tie
     * tvorili 9 z 10 duplicít objavených pri backfille slugov.
     */
    private function scan(MindService $mind): void
    {
        $groups = Node::query()
            ->whereNotNull('slug')
            ->where('slug', '<>', '')
            ->get(['id', 'slug', 'type', 'label', 'strength'])
            ->groupBy('slug')
            ->filter(fn ($group) => $group->count() > 1);

        $added = 0;

        foreach ($groups as $group) {
            $list = $group->values();

            for ($i = 0; $i < $list->count() - 1; $i++) {
                for ($j = $i + 1; $j < $list->count(); $j++) {
                    [$a, $b] = [$list[$i], $list[$j]];

                    $recorded = $mind->recordMergeCandidate(
                        $a,
                        $b,
                        100.0,
                        $a->type === $b->type ? 'same_slug' : 'cross_type_slug',
                    );

                    if ($recorded?->wasRecentlyCreated) {
                        $added++;
                    }
                }
            }
        }

        $this->info("Scan: {$groups->count()} kolidujúcich slugov, {$added} nových návrhov.");
    }

    private function listCandidates(): int
    {
        $query = MergeCandidate::with(['nodeA.area', 'nodeB.area'])->orderByDesc('score');

        if (! $this->option('all')) {
            $query->pending();
        }

        $rows = $query->get();

        if ($rows->isEmpty()) {
            $this->info('Žiadne návrhy na zlúčenie.');

            return self::SUCCESS;
        }

        $this->table(
            ['#', 'skóre', 'dôvod', 'A', 'B', 'stav'],
            $rows->map(fn (MergeCandidate $c) => [
                $c->id,
                number_format($c->score, 1),
                $c->reason,
                $this->describe($c->nodeA),
                $this->describe($c->nodeB),
                $c->status,
            ])->all(),
        );

        $this->line('');
        $this->line('Zlúčiť:   php artisan mind:duplicates --merge=<#>');
        $this->line('Zamietnuť: php artisan mind:duplicates --reject=<#>');

        return self::SUCCESS;
    }

    private function describe(?Node $node): string
    {
        if (! $node) {
            return '(zmazaný)';
        }

        return "[{$node->id}] {$node->label} · {$node->type} · sila ".(int) $node->strength;
    }

    private function merge(MindService $mind, int $id): int
    {
        $candidate = MergeCandidate::with(['nodeA', 'nodeB'])->find($id);

        if (! $candidate || $candidate->status !== MergeCandidate::STATUS_PENDING) {
            $this->error("Návrh {$id} neexistuje alebo už bol vybavený.");

            return self::FAILURE;
        }

        [$a, $b] = [$candidate->nodeA, $candidate->nodeB];

        if (! $a || ! $b) {
            $this->error('Jeden z uzlov už neexistuje.');

            return self::FAILURE;
        }

        if ($keep = $this->option('keep')) {
            $winner = ((int) $keep === $a->id) ? $a : $b;
        } else {
            $winner = (float) $a->strength >= (float) $b->strength ? $a : $b;
        }

        $loser = $winner->is($a) ? $b : $a;

        $this->warn("Zlučujem [{$loser->id}] {$loser->label}  →  [{$winner->id}] {$winner->label}");

        $mind->mergeNodes($loser->fresh(), $winner->fresh());

        $candidate->update([
            'status' => MergeCandidate::STATUS_MERGED,
            'resolved_at' => now(),
        ]);

        $this->info('Hotovo. Zlúčenie je vratné — porazený uzol je soft-zmazaný.');

        return self::SUCCESS;
    }

    private function reject(int $id): int
    {
        $candidate = MergeCandidate::find($id);

        if (! $candidate) {
            $this->error("Návrh {$id} neexistuje.");

            return self::FAILURE;
        }

        $candidate->update([
            'status' => MergeCandidate::STATUS_REJECTED,
            'resolved_at' => now(),
        ]);

        $this->info("Návrh {$id} zamietnutý — už sa nebude vracať.");

        return self::SUCCESS;
    }
}
