<?php

namespace App\Console\Commands;

use App\Models\Tag;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * A11 — zmaže tagy, ktoré neukazujú na žiadny uzol.
 *
 * Tagy sa doteraz len pridávali a nikdy neupratovali: 3 663 tagov na 2 590
 * uzlov, rast ×26,8 za dva týždne. Väzby zanikajú prirodzene (uzol sa zlúči,
 * archivuje alebo zmaže), ale samotný tag ostával navždy.
 *
 * Mazanie je bezstratové: tag bez jedinej väzby nenesie žiadnu informáciu
 * a `node_tag` je jediný zdroj pravdy o tom, či sa používa.
 */
class MindPruneTags extends Command
{
    protected $signature = 'mind:prune-tags {--dry-run : Len vypíš, čo by sa zmazalo}';

    protected $description = 'Zmaže tagy bez väzby na akýkoľvek uzol';

    public function handle(): int
    {
        $orphans = Tag::query()
            ->whereNotExists(fn ($q) => $q->select(DB::raw(1))
                ->from('node_tag')
                ->whereColumn('node_tag.tag_id', 'tags.id'))
            ->get(['id', 'name']);

        if ($orphans->isEmpty()) {
            $this->info('Prune tags: žiadne osirelé tagy.');

            return self::SUCCESS;
        }

        if ($this->option('dry-run')) {
            $this->info("Prune tags (dry-run): zmazalo by sa {$orphans->count()} tagov.");
            $this->line('  '.$orphans->take(30)->pluck('name')->implode(', ').($orphans->count() > 30 ? ' …' : ''));

            return self::SUCCESS;
        }

        Tag::whereIn('id', $orphans->pluck('id'))->delete();

        $this->info("Prune tags: zmazaných {$orphans->count()} tagov bez väzby. Zostáva ".Tag::count().'.');

        return self::SUCCESS;
    }
}
