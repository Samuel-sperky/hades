<?php

namespace App\Console\Commands;

use App\Models\Node;
use App\Services\SummaryService;
use Illuminate\Console\Command;
use Illuminate\Support\Str;
use Throwable;

/**
 * Týždenný živý roll-up každého projektu do summaries/projects/<slug>.md
 * (SummaryService::forProjectRollup). Prepíše sa pri každom behu.
 */
class MindRollup extends Command
{
    protected $signature = 'mind:rollup';

    protected $description = 'Zapíše živý súhrn každého projektu do summaries/projects/<slug>.md';

    public function handle(SummaryService $summaries): int
    {
        $byProject = Node::where('source', 'session')
            ->get()
            ->groupBy(fn (Node $n) => (string) ($n->meta['project'] ?? 'projekt'));

        $written = 0;
        foreach ($byProject as $project => $nodes) {
            $project = trim((string) $project);
            if ($project === '') {
                continue;
            }

            $md = $summaries->forProjectRollup($project, $nodes);
            $rel = 'summaries/projects/'.Str::slug($project).'.md';
            if ($this->write($rel, $md)) {
                $written++;
            }
        }

        $this->info("Rollup: zapísaných {$written} projektových súhrnov.");

        return self::SUCCESS;
    }

    /** Zápis do <base_path>/<relPath>, vytvorí adresár ak treba. */
    protected function write(string $relPath, string $contents): bool
    {
        try {
            $full = base_path($relPath);
            $dir = dirname($full);
            if (! is_dir($dir)) {
                @mkdir($dir, 0775, true);
            }

            return @file_put_contents($full, $contents) !== false;
        } catch (Throwable) {
            return false;
        }
    }
}
