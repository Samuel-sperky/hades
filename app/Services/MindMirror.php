<?php

namespace App\Services;

use App\Models\Area;
use App\Models\Department;
use App\Models\Edge;
use App\Models\Node;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Zrkadlí vedomie (uzly z DB) do priehľadných .md súborov v priečinku `mind/`.
 *
 * Jednosmerne: DB je zdroj pravdy, súbory sú odvodené a kedykoľvek
 * regenerovateľné cez `php artisan mind:export`. Štruktúra priečinkov kopíruje
 * vedomie: Oblasť → Oddelenie → uzol.md.
 */
class MindMirror
{
    protected function enabled(): bool
    {
        return (bool) config('hades.mirror_enabled', true);
    }

    protected function disk()
    {
        return Storage::disk('mind');
    }

    /**
     * Zapíše .md súbor uzla. Ak `$original` opisuje inú predošlú cestu
     * (premenovanie / presun do inej oblasti), starý súbor najprv zmaže.
     */
    public function export(Node $node, ?array $original = null): void
    {
        if (! $this->enabled()) {
            return;
        }

        $newPath = $this->pathFor($node);

        if ($original !== null) {
            $oldPath = $this->pathForAttributes(
                $original['type'] ?? $node->type,
                $original['area_id'] ?? $node->area_id,
                $original['department_id'] ?? $node->department_id,
                $original['label'] ?? $node->label,
                $node->id,
            );

            if ($oldPath !== $newPath && $this->disk()->exists($oldPath)) {
                $this->disk()->delete($oldPath);
                $this->pruneEmptyDirs(dirname($oldPath));
            }
        }

        $this->writeAtomic($newPath, $this->render($node));
    }

    /**
     * Re-export uzla podľa id (napr. po zmene hrany, aby sa obnovil zoznam spojení).
     * Používajú observery hrán/oblastí/oddelení.
     */
    public function exportById(int $id): void
    {
        if (! $this->enabled()) {
            return;
        }

        $node = Node::with(['area', 'department'])->find($id);
        if ($node) {
            $this->export($node);
        }
    }

    /**
     * Zmaže .md súbor uzla a prereže prázdne rodičovské priečinky.
     */
    public function forget(Node $node, ?array $attributes = null): void
    {
        if (! $this->enabled()) {
            return;
        }

        $path = $attributes
            ? $this->pathForAttributes(
                $attributes['type'] ?? $node->type,
                $attributes['area_id'] ?? $node->area_id,
                $attributes['department_id'] ?? $node->department_id,
                $attributes['label'] ?? $node->label,
                $node->id,
            )
            : $this->pathFor($node);

        if ($this->disk()->exists($path)) {
            $this->disk()->delete($path);
            $this->pruneEmptyDirs(dirname($path));
        }
    }

    /**
     * Zmaže celý strom `mind/` (okrem .gitkeep) a regeneruje všetky uzly + indexy.
     * Funguje aj počas seedovania (priame volanie, nezávislé od model eventov).
     */
    public function rebuild(): void
    {
        if (! $this->enabled()) {
            return;
        }

        foreach ($this->disk()->allFiles() as $file) {
            if (basename($file) !== '.gitkeep') {
                $this->disk()->delete($file);
            }
        }
        foreach ($this->disk()->directories() as $dir) {
            $this->disk()->deleteDirectory($dir);
        }

        Node::with(['area', 'department'])
            ->orderBy('id')
            ->get()
            ->each(fn (Node $node) => $this->export($node));

        $this->writeIndexes();
    }

    // ---- cesty ------------------------------------------------------------

    public function pathFor(Node $node): string
    {
        return $this->pathForAttributes(
            $node->type,
            $node->area_id,
            $node->department_id,
            $node->label,
            $node->id,
        );
    }

    /** Cesta relatívna ku koreňu repozitára (na zobrazenie v UI). */
    public function relativePathFor(Node $node): string
    {
        return 'mind/'.$this->pathFor($node);
    }

    protected function pathForAttributes(string $type, ?int $areaId, ?int $departmentId, string $label, int $id): string
    {
        $file = $this->slug($label).'-'.$id.'.md';

        if ($type === 'core') {
            return '_core/'.$file;
        }

        if (! $areaId) {
            return '_unsorted/'.$file;
        }

        $areaSlug = Area::find($areaId)?->slug ?? '_unsorted';

        if ($departmentId && ($deptSlug = Department::find($departmentId)?->slug)) {
            return $areaSlug.'/'.$deptSlug.'/'.$file;
        }

        return $areaSlug.'/'.$file;
    }

    public function slug(string $label): string
    {
        $slug = Str::slug($label);

        if ($slug === '') {
            $slug = 'node';
        }

        return Str::limit($slug, 80, '');
    }

    // ---- render -----------------------------------------------------------

    /**
     * Vyrenderuje celý .md dokument uzla: YAML frontmatter + telo + spojenia.
     */
    public function render(Node $node): string
    {
        $connections = $this->connectionLabels($node);

        $front = [];
        $front[] = 'id: '.$node->id;
        $front[] = 'type: '.$node->type;
        $front[] = 'area: '.$this->yaml($node->area?->name);
        $front[] = 'area_slug: '.$this->yaml($node->area?->slug);
        $front[] = 'department: '.$this->yaml($node->department?->name);
        $front[] = 'strength: '.$this->number($node->strength);
        $front[] = 'source: '.$this->yaml($node->source);
        $front[] = 'created_at: '.$this->yaml($node->created_at?->toIso8601String());
        $front[] = 'last_activated_at: '.$this->yaml($node->last_activated_at?->toIso8601String());
        $front[] = 'connections:'.$this->yamlList($connections);
        $front[] = 'aliases:'.$this->yamlList([$node->label]);

        $body = "# ".$node->label."\n";

        $description = trim((string) $node->description);
        if ($description !== '') {
            $body .= "\n".$description."\n";
        }

        if ($connections) {
            $body .= "\n## Spojenia\n\n";
            foreach ($connections as $label) {
                $body .= '- [['.$label.']]'."\n";
            }
        }

        return "---\n".implode("\n", $front)."\n---\n\n".$body;
    }

    /** Labely susedných uzlov (obojsmerne cez hrany). */
    protected function connectionLabels(Node $node): array
    {
        $neighborIds = Edge::query()
            ->where('source_id', $node->id)
            ->orWhere('target_id', $node->id)
            ->get(['source_id', 'target_id'])
            ->flatMap(fn (Edge $e) => [$e->source_id, $e->target_id])
            ->reject(fn ($id) => $id === $node->id)
            ->unique()
            ->values();

        if ($neighborIds->isEmpty()) {
            return [];
        }

        return Node::whereIn('id', $neighborIds)
            ->orderBy('label')
            ->pluck('label')
            ->all();
    }

    // ---- indexy -----------------------------------------------------------

    public function writeIndexes(): void
    {
        $areas = Area::with('departments')->withCount('nodes')->orderBy('angle')->get();

        // Koreňový prehľad
        $root = "# ".config('hades.name')." — myseľ\n\n";
        $root .= "Priehľadné zrkadlo vedomia. Zdroj pravdy je databáza; tieto súbory sú\n";
        $root .= "automaticky generované a dajú sa obnoviť príkazom `php artisan mind:export`.\n\n";
        $root .= "- Uzlov: ".Node::count()."\n";
        $root .= "- Spojení: ".Edge::count()."\n\n";
        $root .= "## Oblasti\n\n";
        $root .= "| Oblasť | Uzlov | Oddelenia |\n|---|---|---|\n";
        foreach ($areas as $area) {
            $depts = $area->departments->pluck('name')->implode(', ');
            $root .= '| ['.$area->name.']('.$area->slug.'/README.md) | '.$area->nodes_count.' | '.$depts." |\n";
        }
        $this->writeAtomic('README.md', $root);

        // Index každej oblasti
        foreach ($areas as $area) {
            $index = "# ".$area->name."\n\n";

            $nodes = Node::where('area_id', $area->id)->with('department')->orderBy('label')->get();
            foreach ($nodes as $node) {
                $prefix = $node->department ? '['.$node->department->name.'] ' : '';
                $index .= '- '.$prefix.'[['.$node->label.']]'."\n";
            }

            if ($nodes->isEmpty()) {
                $index .= "_Zatiaľ žiadne uzly._\n";
            }

            $this->writeAtomic($area->slug.'/README.md', $index);
        }
    }

    // ---- IO / formátovanie ------------------------------------------------

    /** Zapíše obsah „atomicky" cez dočasný súbor + rename (rovnaký filesystem). */
    protected function writeAtomic(string $path, string $contents): void
    {
        $dir = dirname($path);
        if ($dir !== '' && $dir !== '.') {
            $this->disk()->makeDirectory($dir);
        }

        $tmp = ($dir === '.' ? '' : $dir.'/').'.'.basename($path).'.tmp';
        $this->disk()->put($tmp, $contents);

        $full = $this->disk()->path($path);
        @rename($this->disk()->path($tmp), $full);

        // Poistka, ak by rename zlyhal (napr. cross-device).
        if ($this->disk()->exists($tmp)) {
            $this->disk()->put($path, $contents);
            $this->disk()->delete($tmp);
        }
    }

    /** Rekurzívne prereže prázdne priečinky smerom hore. */
    protected function pruneEmptyDirs(string $dir): void
    {
        while ($dir !== '' && $dir !== '.' && $dir !== '/') {
            if ($this->disk()->files($dir) || $this->disk()->directories($dir)) {
                return;
            }

            $this->disk()->deleteDirectory($dir);
            $dir = dirname($dir);
        }
    }

    /** Bezpečný YAML skalár (labely môžu obsahovať `:`, úvodzovky, diakritiku). */
    protected function yaml(?string $value): string
    {
        if ($value === null || $value === '') {
            return '""';
        }

        $escaped = str_replace(['\\', '"', "\n", "\r"], ['\\\\', '\\"', '\\n', ''], $value);

        return '"'.$escaped.'"';
    }

    protected function yamlList(array $values): string
    {
        if (! $values) {
            return ' []';
        }

        $out = "\n";
        foreach ($values as $value) {
            $out .= '  - '.$this->yaml((string) $value)."\n";
        }

        return rtrim($out, "\n");
    }

    protected function number(float|int|null $value): string
    {
        $value = (float) $value;

        return $value == (int) $value ? (string) (int) $value : (string) $value;
    }
}
