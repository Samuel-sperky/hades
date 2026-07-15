<?php

namespace App\Console\Commands;

use App\Models\Activation;
use App\Models\Area;
use App\Models\Node;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * Zapíše denný súhrn vedomia do mind/_daily/YYYY-MM-DD.md (bez LLM, čisto z DB):
 * čo dnes pribudlo, aktivita a zanedbané oblasti (medzery).
 */
class MindDaily extends Command
{
    protected $signature = 'mind:daily';

    protected $description = 'Zapíše denný súhrn vedomia do mind/_daily/*.md';

    public function handle(): int
    {
        if (! config('hades.mirror_enabled', true)) {
            $this->warn('Zrkadlenie je vypnuté.');

            return self::SUCCESS;
        }

        $today = now()->startOfDay();
        $date = now()->format('Y-m-d');

        $new = Node::where('type', '!=', 'core')
            ->where('created_at', '>=', $today)
            ->with('area')
            ->orderByDesc('created_at')
            ->get();

        $activations = Activation::where('created_at', '>=', $today)->count();

        $gaps = Area::withCount('nodes')->get()
            ->sortBy('nodes_count')
            ->take(3);

        $md = "# Denník vedomia — {$date}\n\n";

        $md .= "## Dnes pribudlo ({$new->count()})\n\n";
        if ($new->isEmpty()) {
            $md .= "_Dnes žiadny nový uzol._\n";
        } else {
            foreach ($new as $n) {
                $md .= '- [['.$n->label.']] — '.$n->type.($n->area ? ' · '.$n->area->name : '')."\n";
            }
        }

        $md .= "\n## Aktivita\n\n";
        $md .= '- Nových uzlov: '.$new->count()."\n";
        $md .= '- Aktivácií: '.$activations."\n";

        $md .= "\n## Medzery (najviac zanedbané oblasti)\n\n";
        foreach ($gaps as $a) {
            $md .= '- '.$a->name.' — '.$a->nodes_count." uzlov\n";
        }

        Storage::disk('mind')->put("_daily/{$date}.md", $md);

        $this->info("Denník zapísaný: mind/_daily/{$date}.md");

        return self::SUCCESS;
    }
}
