<?php

namespace App\Console\Commands;

use App\Models\Node;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Export vedomia späť do Claude memory (/memory-rw/hades). Exportuje sa LEN
 * jadro, projekty a najsilnejšie manuálne fakty — max 25 uzlov. Skilly sa
 * NEexportujú (existujú ako skills/*.md a sú dostupné cez Skill tool), inak
 * by index narástol na stovky riadkov a Claude Code by ho načítal len sčasti.
 *
 * Index sa píše do memory/hades/INDEX.md (VLASTNÝ index Hadesa) — NIKDY do
 * hlavného MEMORY.md, ktorý spravuje Claude Code. Staré exporty sa upracú.
 *
 * Ak zapisovateľný mount (/memory-rw) nie je pripojený, príkaz sa bez chyby
 * preskočí.
 */
class MindExportMemory extends Command
{
    protected $signature = 'mind:export-memory';

    protected $description = 'Exportuje jadro + projekty + silné fakty (max 25) do Claude memory (/memory-rw/hades)';

    protected const LIMIT = 25;

    public function handle(): int
    {
        $exportPath = rtrim((string) config('hades.memory_export_path', '/memory-rw/hades'), '/');
        $mountRoot = dirname($exportPath);

        // mount ešte nie je pripojený → graceful no-op
        if (! is_dir($mountRoot)) {
            $this->warn("Memory mount {$mountRoot} nie je pripojený — export preskočený.");
            Log::warning('mind:export-memory: mount chýba', ['mount' => $mountRoot]);

            return self::SUCCESS;
        }

        if (! is_dir($exportPath)) {
            @mkdir($exportPath, 0775, true);
        }

        // exportovateľné: jadro (osobnosť/hodnoty), projekty, pripnuté uzly a
        // manuálne fakty (source null, ne-skill) so silou > 1. ŽIADNE skilly ani
        // session záznamy. Zoradené podľa sily, max 25.
        $nodes = Node::query()
            ->where(function ($q) {
                $q->where('type', 'core')
                    ->orWhere('type', 'project')
                    ->orWhere('pinned', true)
                    ->orWhere(function ($m) {
                        $m->whereNull('source')
                            ->where('type', '!=', 'skill')
                            ->where('strength', '>', 1);
                    });
            })
            ->orderByDesc('strength')
            ->orderBy('label')
            ->limit(self::LIMIT)
            ->get();

        $usedSlugs = [];
        $bullets = [];
        $keepFiles = [];
        $exported = 0;

        foreach ($nodes as $node) {
            $slug = Str::slug($node->label) ?: 'node';
            if (isset($usedSlugs[$slug])) {
                $slug .= '-'.$node->id;
            }
            $usedSlugs[$slug] = true;

            $file = $exportPath.'/'.$slug.'.md';
            if (@file_put_contents($file, $this->document($node)) !== false) {
                $exported++;
                $keepFiles[$slug.'.md'] = true;
                $bullets[] = '- ['.$node->label.'](./'.$slug.'.md) — '.$this->oneLine($node->description);
            }
        }

        // vlastný index Hadesa (NIE hlavné MEMORY.md)
        $index = "# Hades — exportované vedomie\n\n"
            .'Jadro, projekty a najsilnejšie fakty ('.$exported." uzlov). Skilly sú v skills/*.md.\n\n"
            .implode("\n", $bullets)."\n";
        @file_put_contents($exportPath.'/INDEX.md', $index);
        $keepFiles['INDEX.md'] = true;

        $pruned = $this->pruneStale($exportPath, $keepFiles);

        $this->info("Export: {$exported} uzlov do {$exportPath}, upratané {$pruned} starých.");

        return self::SUCCESS;
    }

    /**
     * Zmaže staré .md súbory v exporte, ktoré už nie sú medzi aktuálnymi (napr.
     * skilly z predošlej verzie, ktorá exportovala stovky súborov).
     *
     * @param  array<string, bool>  $keep
     */
    protected function pruneStale(string $exportPath, array $keep): int
    {
        $pruned = 0;
        foreach (glob($exportPath.'/*.md') ?: [] as $path) {
            if (! isset($keep[basename($path)])) {
                @unlink($path) && $pruned++;
            }
        }

        return $pruned;
    }

    /** .md dokument uzla s frontmatterom (name, description, source, node_id). */
    protected function document(Node $node): string
    {
        $out = [];
        $out[] = '---';
        $out[] = 'name: '.$this->yaml((string) $node->label);
        $out[] = 'description: '.$this->yaml($this->oneLine($node->description));
        $out[] = 'source: hades';
        $out[] = 'node_id: '.$node->id;
        $out[] = '---';
        $out[] = '';
        $out[] = '# '.$node->label;
        $out[] = '';
        $out[] = trim((string) $node->description);

        return implode("\n", $out)."\n";
    }

    /** Jednoriadkový, zbalený popis pre index/ frontmatter. */
    protected function oneLine(?string $text): string
    {
        return Str::limit(trim(preg_replace('/\s+/u', ' ', (string) $text)), 160, '…');
    }

    /** Bezpečná YAML hodnota v úvodzovkách. */
    protected function yaml(string $value): string
    {
        return '"'.str_replace('"', '\"', trim($value)).'"';
    }
}
