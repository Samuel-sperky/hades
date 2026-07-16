<?php

namespace App\Console\Commands;

use App\Events\MindPulse;
use App\Models\Area;
use App\Models\Department;
use App\Models\Edge;
use App\Models\Node;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

class MindSeedSkills extends Command
{
    protected $signature = 'mind:seed-skills';

    protected $description = 'Naseeduje skill uzly z playbookov v skills/<oblast>/*.md do mozgu';

    /** Priecinok oblasti -> slug oblasti v mozgu + nazov oddelenia */
    protected array $areaMap = [
        'it' => ['vyvoj-kod', 'IT'],
        'ai-nastroje' => ['vyvoj-kod', 'AI nástroje'],
        'marketing' => ['marketing-seo', 'Marketing'],
        'design' => ['dizajn-kreativa', 'Design'],
        'biznis-sperky' => ['biznis-projekty', 'Biznis šperky'],
        'produktivita' => ['osobne-preferencie', 'Produktivita'],
    ];

    public function handle(): int
    {
        $baseHost = base_path('skills');
        if (! is_dir($baseHost)) {
            $this->error('Priečinok skills/ neexistuje.');

            return self::FAILURE;
        }

        $files = glob($baseHost.'/*/*.md') ?: [];
        $created = 0;
        $updated = 0;

        foreach ($files as $file) {
            $areaFolder = basename(dirname($file));
            $slug = pathinfo($file, PATHINFO_FILENAME);
            [$areaSlug, $deptName] = $this->areaMap[$areaFolder] ?? ['vyvoj-kod', ucfirst($areaFolder)];

            $content = file_get_contents($file);
            $title = $this->extractTitle($content) ?: Str::headline($slug);
            $oneLiner = $this->extractOneLiner($content);

            $area = Area::where('slug', $areaSlug)->first();
            $dept = $area
                ? Department::firstOrCreate(
                    ['area_id' => $area->id, 'slug' => Str::slug($deptName)],
                    ['name' => $deptName],
                )
                : null;

            $key = 'skill:'.$areaFolder.'/'.$slug;
            $existed = Node::where('external_key', $key)->exists();

            $node = Node::updateOrCreate(
                ['external_key' => $key],
                [
                    'type' => 'skill',
                    'source' => 'skill',
                    'area_id' => $area?->id,
                    'department_id' => $dept?->id,
                    'label' => $title,
                    'description' => $oneLiner,
                    'meta' => [
                        'path' => 'skills/'.$areaFolder.'/'.$slug.'.md',
                        'area_folder' => $areaFolder,
                        'department' => $deptName,
                    ],
                    'strength' => 3,
                    'last_activated_at' => now(),
                ],
            );

            $existed ? $updated++ : $created++;

            if (! $existed) {
                MindPulse::dispatch('node.created', ['node' => $node->toApi()]);
            }
        }

        // prepoj skills v ramci oddelenia do klastra — oddelenie hladaj v ramci
        // spravnej oblasti, slug sam o sebe nie je unikatny naprieč oblastami
        foreach ($this->areaMap as $folder => [$areaSlug, $deptName]) {
            $area = Area::where('slug', $areaSlug)->first();
            if (! $area) {
                continue;
            }

            $dept = Department::where('area_id', $area->id)->where('slug', Str::slug($deptName))->first();
            if (! $dept) {
                continue;
            }
            $ids = Node::where('type', 'skill')->where('department_id', $dept->id)->pluck('id')->all();
            for ($i = 0; $i < count($ids) - 1; $i++) {
                [$s, $t] = $ids[$i] < $ids[$i + 1] ? [$ids[$i], $ids[$i + 1]] : [$ids[$i + 1], $ids[$i]];
                Edge::firstOrCreate(['source_id' => $s, 'target_id' => $t], ['weight' => 1, 'last_activated_at' => now()]);
            }
        }

        $this->info("Skills: nové {$created}, aktualizované {$updated}, súbory ".count($files));

        return self::SUCCESS;
    }

    protected function extractTitle(string $c): ?string
    {
        if (preg_match('/^#\s+(.+)$/m', $c, $m)) {
            return trim($m[1]);
        }

        return null;
    }

    protected function extractOneLiner(string $c): string
    {
        // prvy neprazdny riadok po nadpise, ktory nie je heading
        $lines = preg_split('/\r?\n/', $c);
        $seenH1 = false;
        foreach ($lines as $line) {
            $t = trim($line);
            if (! $seenH1) {
                if (Str::startsWith($t, '# ')) {
                    $seenH1 = true;
                }

                continue;
            }
            if ($t === '' || Str::startsWith($t, '#')) {
                continue;
            }

            return Str::limit(ltrim($t, '- '), 220);
        }

        return '';
    }
}
