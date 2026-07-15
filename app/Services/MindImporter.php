<?php

namespace App\Services;

use App\Models\Area;
use App\Models\Department;
use App\Models\Node;
use Illuminate\Support\Facades\Storage;

/**
 * Obojsmerné zrkadlo: načíta ručné úpravy `.md` súborov (napr. z Obsidianu)
 * späť do databázy. Zdroj pravdy je DB, ale `mind:import` je explicitné
 * premietnutie zmien zo súborov do DB. Bez LLM — čistý parser.
 */
class MindImporter
{
    public function __construct(protected SensitiveFilter $filter = new SensitiveFilter) {}

    protected function disk()
    {
        return Storage::disk('mind');
    }

    /**
     * @return array{updated:int, skipped:int, rejected:int}
     */
    public function import(): array
    {
        $updated = 0;
        $skipped = 0;
        $rejected = 0;

        foreach ($this->disk()->allFiles() as $path) {
            if (! str_ends_with($path, '.md') || basename($path) === 'README.md' || str_starts_with($path, '_daily/')) {
                continue;
            }

            $parsed = $this->parse($this->disk()->get($path));
            if (! $parsed) {
                $skipped++;

                continue;
            }

            $id = (int) ($parsed['front']['id'] ?? 0);
            $node = $id ? Node::find($id) : null;
            if (! $node) {
                $skipped++;

                continue;
            }

            // Bezpecnostny filter aj na import — nikdy neuklada tajomstva.
            if ($this->filter->scan($parsed['label'], $parsed['description'])) {
                $rejected++;

                continue;
            }

            if ($this->applyTo($node, $parsed)) {
                $updated++;
            }
        }

        return ['updated' => $updated, 'skipped' => $skipped, 'rejected' => $rejected];
    }

    protected function applyTo(Node $node, array $parsed): bool
    {
        $changes = [];

        if ($parsed['label'] !== '' && $parsed['label'] !== $node->label) {
            $changes['label'] = $parsed['label'];
        }

        $desc = $parsed['description'];
        if ($desc !== (string) $node->description) {
            $changes['description'] = $desc !== '' ? $desc : null;
        }

        $source = $parsed['front']['source'] ?? null;
        if ($source !== null && $source !== (string) $node->source) {
            $changes['source'] = $source !== '' ? $source : null;
        }

        // Presun do inej oblasti podla area_slug (nie pre core)
        if ($node->type !== 'core' && ! empty($parsed['front']['area_slug'])) {
            $area = Area::where('slug', $parsed['front']['area_slug'])->first();
            if ($area && $area->id !== $node->area_id) {
                $changes['area_id'] = $area->id;
                $changes['department_id'] = null;

                if (! empty($parsed['front']['department'])) {
                    $dept = Department::where('area_id', $area->id)
                        ->where('name', $parsed['front']['department'])->first();
                    if ($dept) {
                        $changes['department_id'] = $dept->id;
                    }
                }
            }
        }

        if (! $changes) {
            return false;
        }

        $node->update($changes); // spusti observer -> re-export .md (normalizacia)

        return true;
    }

    /**
     * @return array{front: array<string,string>, label: string, description: string}|null
     */
    public function parse(string $content): ?array
    {
        if (! preg_match('/^---\n(.*?)\n---\n?(.*)$/s', $content, $m)) {
            return null;
        }

        $front = $this->parseFrontmatter($m[1]);
        $body = $m[2];

        // Label = prvy `# ` nadpis
        $label = '';
        if (preg_match('/^#\s+(.+)$/m', $body, $lm)) {
            $label = trim($lm[1]);
        }

        // Popis = telo medzi nadpisom a `## ` (napr. Spojenia), bez nadpisu
        $afterTitle = preg_replace('/^#\s+.+$/m', '', $body, 1);
        $desc = preg_split('/^##\s+/m', (string) $afterTitle)[0] ?? '';

        return [
            'front' => $front,
            'label' => $label,
            'description' => trim($desc),
        ];
    }

    /**
     * @return array<string,string>
     */
    protected function parseFrontmatter(string $yaml): array
    {
        $out = [];
        foreach (explode("\n", $yaml) as $line) {
            if (! preg_match('/^([a-z_]+):\s*(.*)$/i', $line, $m)) {
                continue; // preskoc polozky zoznamov (odsadene `  - ...`)
            }
            $out[$m[1]] = $this->unquote(trim($m[2]));
        }

        return $out;
    }

    protected function unquote(string $v): string
    {
        if ($v === '' || $v === '[]') {
            return '';
        }
        if (str_starts_with($v, '"') && str_ends_with($v, '"')) {
            $v = substr($v, 1, -1);

            return str_replace(['\\"', '\\n', '\\\\'], ['"', "\n", '\\'], $v);
        }

        return $v;
    }
}
