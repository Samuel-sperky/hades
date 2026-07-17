<?php

namespace App\Console\Commands;

use App\Models\Node;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * C2/C5/C6 — export vedomia späť do Claude memory. Exportujú sa LEN skilly a
 * manuálne fakty (type = skill ALEBO source = null, ne-core) — NIE session
 * záznamy ani digesty. Každý uzol ide do <export>/hades/<slug>.md, index MEMORY.md
 * sa aktualizuje IBA v bloku medzi značkami HADES:START a HADES:END.
 *
 * Ak zapisovateľný mount (/memory-rw) nie je pripojený, príkaz sa bez chyby
 * preskočí (aby nespadol pred aplikovaním compose zmeny).
 */
class MindExportMemory extends Command
{
    protected $signature = 'mind:export-memory';

    protected $description = 'Exportuje skilly a manuálne fakty do Claude memory (/memory-rw) + index blok';

    protected const MARKER_START = '<!-- HADES:START -->';

    protected const MARKER_END = '<!-- HADES:END -->';

    public function handle(): int
    {
        $exportPath = rtrim((string) config('hades.memory_export_path', '/memory-rw/hades'), '/');
        $indexPath = (string) config('hades.memory_index_path', '/memory-rw/MEMORY.md');
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

        // exportovateľné: skill uzly ALEBO manuálne fakty (source null), nikdy jadro
        $nodes = Node::query()
            ->where('type', '!=', 'core')
            ->where(function ($q) {
                $q->where('type', 'skill')->orWhereNull('source');
            })
            ->orderBy('label')
            ->get();

        $dirName = basename($exportPath);
        $usedSlugs = [];
        $bullets = [];
        $exported = 0;

        foreach ($nodes as $node) {
            $slug = Str::slug($node->label) ?: 'node';
            // kolízia slugov → priprav id, aby sa súbory neprepisovali
            if (isset($usedSlugs[$slug])) {
                $slug .= '-'.$node->id;
            }
            $usedSlugs[$slug] = true;

            $file = $exportPath.'/'.$slug.'.md';
            if (@file_put_contents($file, $this->document($node)) !== false) {
                $exported++;
                $bullets[] = '- ['.$node->label.']('.$dirName.'/'.$slug.'.md) — '.$this->oneLine($node->description);
            }
        }

        $this->updateIndex($indexPath, $bullets);

        $this->info("Export: {$exported} uzlov do {$exportPath}.");

        return self::SUCCESS;
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

    /**
     * Prepíše IBA blok medzi značkami. Text mimo značiek sa nikdy nedotkne.
     * Ak blok chýba, pripne sa na koniec súboru.
     *
     * @param  array<int, string>  $bullets
     */
    protected function updateIndex(string $indexPath, array $bullets): void
    {
        $inner = $bullets === [] ? '' : "\n".implode("\n", $bullets)."\n";
        $block = self::MARKER_START.$inner.self::MARKER_END;

        $existing = is_file($indexPath) ? (string) @file_get_contents($indexPath) : '';

        $s = strpos($existing, self::MARKER_START);
        $e = strpos($existing, self::MARKER_END);

        if ($s !== false && $e !== false && $e >= $s) {
            // čisté string-splice — bez regexu, aby $ / \ v obsahu nič nerozbili
            $new = substr($existing, 0, $s).$block.substr($existing, $e + strlen(self::MARKER_END));
        } else {
            $sep = ($existing === '' || str_ends_with($existing, "\n")) ? '' : "\n";
            $new = $existing.$sep."\n".$block."\n";
        }

        @file_put_contents($indexPath, $new);
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
