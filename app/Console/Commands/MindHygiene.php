<?php

namespace App\Console\Commands;

use App\Models\MergeCandidate;
use App\Models\Node;
use App\Services\MindService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Hygienická správa nad živou pamäťou — POČÍTA a POPISUJE, nikdy nemaže.
 *
 * Sieť narástla na 2 672 uzlov a časť z nich nenesie znalosť: surové vety
 * používateľa uložené ako label, markdown v labeli, strojové slugy, uzly bez
 * popisu, uzly bez jedinej hrany. Doteraz sa to dalo zistiť len ručným dopytom
 * do DB, takže to nikto nezisťoval.
 *
 * Príkaz je zámerne len čítací. Deštruktívne operácie nad pamäťou nikdy nebežia
 * autonómne — a rovnaká skúsenosť, ktorá zrušila automatické zlučovanie
 * (26. 7. 2026 automerge nevratne pohltil „Súhrn týždňa 30/2026" do „…29/2026"),
 * platí aj tu: „vypadá to ako odpad" nie je dôvod na zmazanie. `--fix` preto
 * existuje len pre dve vratné triedy (markdown z labelu, biele znaky), defaultne
 * je vypnutý a bez `--force` iba vypíše diff.
 *
 * Klasifikátor odpadu je JEDEN — `MindService::noiseOf()`. Ten istý kód
 * označuje uzly v `mind_recall`, takže správa hovorí presne to, čo vidí AI.
 *
 *   php artisan mind:hygiene
 *   php artisan mind:hygiene --class=raw-prompt --limit=20
 *   php artisan mind:hygiene --json
 *   php artisan mind:hygiene --fix            (len náhľad)
 *   php artisan mind:hygiene --fix --force    (zapíše opravy labelov)
 */
class MindHygiene extends Command
{
    protected $signature = 'mind:hygiene
        {--class= : Len jedna trieda (raw-prompt, markdown, tag-sprawl, duplicate, slug, oversized, misfiled, stub, orphan)}
        {--limit=5 : Koľko príkladov na triedu}
        {--json : Strojový výstup namiesto tabuliek}
        {--fix : Náhľad opravy dvoch bezpečných tried — markdown v labeli a biele znaky}
        {--force : Spolu s --fix opravy skutočne zapíše}
        {--no-file : Nezapisovať správu do storage/app}';

    protected $description = 'Hygienická správa nad pamäťou: odpad, siroty, duplicity, preplnené tagy — iba počíta, nič nemaže';

    /**
     * Váha = koľko tá trieda stojí AI pri jednom recalle, nie koľko je jej v sieti.
     *
     * Poradie nie je vec vkusu. Label ide do každej odpovede recallu, popis len
     * skrátený, a uzol, ktorý sa nikdy nevráti, nestojí nič okrem riadku v DB:
     *
     *   5  label je nepoužiteľný a AI podľa neho koná (surová veta vyzerá ako
     *      poznatok, ktorý nikto nezapísal)
     *   4  label je čitateľný, ale zavádza; alebo uzol lezie do cudzích dopytov
     *      (každý tag nad stropom je ďalší dopyt, v ktorom sa uzol vynorí)
     *   3  ten istý poznatok dvakrát — delí silu a berie slot v odpovedi
     *   2  znalosť v uzle je, ale recall ju neunesie (popis nad stropom sa vždy
     *      ureže) alebo ju nenájde v správnej oblasti
     *   1  plytvá riadkom, recall nekazí
     */
    private const CLASSES = [
        'raw-prompt' => [5, 'Surová veta ako label', 'Label je useknutý prompt — AI ho číta ako poznatok a verí mu.'],
        'markdown' => [4, 'Markdown v labeli', 'Label nesie „#" a „**" — v odpovedi je to šum a v UI rozbitý text.'],
        'tag-sprawl' => [4, 'Rozlezené tagy', 'Nad stropom recallu; každý tag navyše vtiahne uzol do cudzieho dopytu.'],
        'duplicate' => [3, 'Kandidát na duplicitu', 'Ten istý poznatok dvakrát — delená sila a dva sloty v jednej odpovedi.'],
        'slug' => [3, 'Strojový slug', 'Label typu „charming-chaum-da6141" nepovie AI ani človeku nič.'],
        'oversized' => [2, 'Prerastený popis', 'Nad stropom recallu — väčšina textu sa do odpovede nikdy nedostane.'],
        'misfiled' => [2, 'Zle zaradený uzol', 'Oblasť nesedí s okolím, takže recall zúžený na oblasť ho nenájde.'],
        'stub' => [1, 'Uzol bez popisu', 'Nesie len meno — plytvá riadkom, ale recall nekazí.'],
        'orphan' => [1, 'Sirota bez hrán', 'Bez hrany ho nevytiahne žiadny sused — žije len na presné slovo.'],
    ];

    /** Susedov treba aspoň toľko, aby ich väčšina bola signál a nie náhoda. */
    private const MISFILED_MIN_NEIGHBOURS = 4;

    /** Podiel susedov v jednej cudzej oblasti, od ktorého to prestáva byť náhoda. */
    private const MISFILED_SHARE = 0.8;

    public function handle(MindService $mind): int
    {
        $only = $this->option('class');

        if ($only !== null && ! isset(self::CLASSES[$only])) {
            $this->error("Neznáma trieda „{$only}“. Známe: ".implode(', ', array_keys(self::CLASSES)).'.');

            return self::FAILURE;
        }

        if ($this->option('force') && ! $this->option('fix')) {
            $this->warn('--force nič nerobí bez --fix. Nič som nezapísal.');
        }

        $limit = max(1, (int) $this->option('limit'));
        $report = $this->collect($mind, $only, $limit);

        if ($this->option('json')) {
            $this->line((string) json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        } else {
            $this->renderText($report);
        }

        if (! $this->option('no-file')) {
            $path = $this->writeFile($report);
            if (! $this->option('json')) {
                $this->line('');
                $this->line("Správa uložená: {$path}");
            }
        }

        if ($this->option('fix')) {
            $this->runFix($mind);
        }

        return self::SUCCESS;
    }

    /**
     * Jeden prechod sieťou. Hrany, tagy a oblasti sa načítajú do pamäti dopredu
     * (8 tisíc hrán je pár stoviek kB), aby na 2 672 uzloch nebežal dopyt na uzol —
     * inak správa nad živou pamäťou trvá minúty a nikto ju nespustí druhý raz.
     *
     * @return array<string, mixed>
     */
    private function collect(MindService $mind, ?string $only, int $limit): array
    {
        $descCap = 2 * (int) config('hades.recall_desc_top_chars', 900);
        $tagCap = max(1, (int) config('hades.recall_tag_cap', 8));

        $areaNames = DB::table('areas')->pluck('name', 'id')->all();
        $liveIds = Node::query()->pluck('id')->all();
        $live = array_fill_keys($liveIds, true);

        $tagCounts = DB::table('node_tag')
            ->select('node_id', DB::raw('COUNT(*) as c'))
            ->groupBy('node_id')
            ->pluck('c', 'node_id')
            ->all();

        // Oblasť susedov sa čita z tejto mapy, nie relačným dotazom na uzol.
        $areaOf = Node::query()->pluck('area_id', 'id')->all();

        $degree = [];
        $neighbourAreas = [];
        foreach (DB::table('edges')->select('source_id', 'target_id')->cursor() as $edge) {
            $s = (int) $edge->source_id;
            $t = (int) $edge->target_id;

            // Hrana na soft-zmazaný uzol nie je spojenie — sirotu by inak schovala.
            if (! isset($live[$s], $live[$t])) {
                continue;
            }

            $degree[$s] = ($degree[$s] ?? 0) + 1;
            $degree[$t] = ($degree[$t] ?? 0) + 1;

            foreach ([[$s, $t], [$t, $s]] as [$from, $to]) {
                $area = $areaOf[$to] ?? null;
                if ($area !== null) {
                    $neighbourAreas[$from][$area] = ($neighbourAreas[$from][$area] ?? 0) + 1;
                }
            }
        }

        $counts = array_fill_keys(array_keys(self::CLASSES), 0);
        $examples = array_fill_keys(array_keys(self::CLASSES), []);
        $worst = [];

        Node::query()
            ->select(['id', 'label', 'description', 'type', 'area_id', 'department_id', 'strength'])
            ->orderBy('id')
            ->chunk(500, function ($nodes) use (
                $mind, $areaNames, $tagCounts, $degree, $neighbourAreas,
                $descCap, $tagCap, $limit, &$counts, &$examples, &$worst
            ) {
                foreach ($nodes as $node) {
                    $hits = [];

                    if ($noise = $mind->noiseOf($node)) {
                        $hits[$noise] = null;
                    }

                    $tags = (int) ($tagCounts[$node->id] ?? 0);
                    if ($tags > $tagCap) {
                        $hits['tag-sprawl'] = "{$tags} tagov (strop recallu je {$tagCap})";
                    }

                    $length = mb_strlen(trim((string) $node->description));
                    if ($length > $descCap) {
                        $hits['oversized'] = "{$length} znakov (strop recallu je {$descCap})";
                    }

                    if (($degree[$node->id] ?? 0) === 0) {
                        $hits['orphan'] = 'bez hrán';
                    }

                    if ($note = $this->misfiledNote($node, $areaNames, $neighbourAreas[$node->id] ?? [])) {
                        $hits['misfiled'] = $note;
                    }

                    foreach ($hits as $class => $note) {
                        $counts[$class]++;

                        if (count($examples[$class]) < $limit) {
                            $examples[$class][] = $this->example($node, $areaNames, $note);
                        }
                    }

                    if ($hits !== []) {
                        $cost = 0;
                        foreach (array_keys($hits) as $class) {
                            $cost += self::CLASSES[$class][0];
                        }
                        $worst[] = [
                            'id' => $node->id,
                            'label' => $this->shorten((string) $node->label, 70),
                            'classes' => array_keys($hits),
                            'cost' => $cost,
                            'strength' => (float) $node->strength,
                        ];
                    }
                }
            });

        [$counts['duplicate'], $examples['duplicate']] = $this->duplicates($limit, $areaNames);

        // Uzol s viac chybami stojí viac než uzol s jednou, takže poradie drží
        // súčet váh. Pri rovnosti rozhoduje SILA: odpad, ktorý sa vracia v
        // každom druhom recalle, stojí viac než ten istý odpad, ktorý nikto
        // nikdy nevytiahol.
        usort($worst, fn (array $a, array $b) => [$b['cost'], $b['strength'], $a['id']]
            <=> [$a['cost'], $a['strength'], $b['id']]);

        $total = count($liveIds);
        $classes = [];

        foreach (self::CLASSES as $key => [$weight, $title, $cost]) {
            if ($only !== null && $key !== $only) {
                continue;
            }

            $classes[] = [
                'class' => $key,
                'title' => $title,
                'weight' => $weight,
                'count' => $counts[$key],
                'share' => $total > 0 ? round(100 * $counts[$key] / $total, 1) : 0.0,
                'burden' => $weight * $counts[$key],
                'costs' => $cost,
                'examples' => $examples[$key],
            ];
        }

        usort($classes, fn (array $a, array $b) => [$b['weight'], $b['count']] <=> [$a['weight'], $a['count']]);

        return [
            'generated_at' => now()->toIso8601String(),
            'nodes' => $total,
            'edges' => DB::table('edges')->count(),
            'thresholds' => [
                'desc_chars' => $descCap,
                'tag_cap' => $tagCap,
                'misfiled_min_neighbours' => self::MISFILED_MIN_NEIGHBOURS,
                'misfiled_share' => self::MISFILED_SHARE,
            ],
            'classes' => $classes,
            'dirty_nodes' => count($worst),
            'worst' => array_slice($worst, 0, 3),
        ];
    }

    /**
     * Zle zaradený uzol. Dve úrovne istoty a ani jedna nie je hádanie z labelu:
     * chýbajúca oblasť je fakt, väčšina susedov v jednej cudzej oblasti je
     * štruktúrny signál. Oddelenie z inej oblasti je rozbitá cesta, nie názor.
     *
     * @param  array<int, string>  $areaNames
     * @param  array<int, int>  $neighbours  oblasť → počet susedov
     */
    private function misfiledNote(Node $node, array $areaNames, array $neighbours): ?string
    {
        // Jadro vedomia stojí nad oblasťami zámerne — nie je to chyba zaradenia.
        if ($node->type === 'core') {
            return null;
        }

        if ($node->area_id === null) {
            return 'bez oblasti — recall zúžený na oblasť ho nevráti';
        }

        if ($node->department_id !== null) {
            $deptArea = $this->departmentAreas()[$node->department_id] ?? null;
            if ($deptArea !== null && $deptArea !== (int) $node->area_id) {
                return 'oddelenie patrí do „'.($areaNames[$deptArea] ?? '?').'“';
            }
        }

        $sum = array_sum($neighbours);
        if ($sum < self::MISFILED_MIN_NEIGHBOURS) {
            return null;
        }

        arsort($neighbours);
        $dominant = (int) array_key_first($neighbours);
        $share = $neighbours[$dominant] / $sum;

        if ($dominant === (int) $node->area_id || $share < self::MISFILED_SHARE) {
            return null;
        }

        $percent = round(100 * $share);

        return "{$percent} % susedov je v „".($areaNames[$dominant] ?? '?').'“';
    }

    /** @return array<int, int> oddelenie → oblasť */
    private function departmentAreas(): array
    {
        static $map = null;

        return $map ??= DB::table('departments')->pluck('area_id', 'id')
            ->map(fn ($id) => (int) $id)->all();
    }

    /**
     * Duplicity sa tu NEPOČÍTAJU znova. Fronta `merge_candidates` je existujúca
     * práca (plní ju mind_learn, mind:automerge aj mind:duplicates --scan) a je
     * to jediné miesto, kde má rozhodnutie človeka svoju pamäť — druhý detektor
     * by len vracal páry, ktoré už boli zamietnuté.
     *
     * @param  array<int, string>  $areaNames
     * @return array{0: int, 1: array<int, array<string, mixed>>}
     */
    private function duplicates(int $limit, array $areaNames): array
    {
        $query = MergeCandidate::with(['nodeA', 'nodeB'])->pending()->orderByDesc('score');

        $examples = $query->clone()->limit($limit)->get()->map(fn (MergeCandidate $c) => [
            'id' => $c->nodeA?->id,
            'label' => $this->shorten((string) ($c->nodeA?->label ?? '(zmazaný)'), 44),
            'type' => $c->nodeA?->type,
            'area' => $areaNames[$c->nodeA?->area_id] ?? null,
            'strength' => (float) ($c->nodeA?->strength ?? 0),
            'note' => 'návrh #'.$c->id.' → ['.($c->nodeB?->id ?? '?').'] '
                .$this->shorten((string) ($c->nodeB?->label ?? '(zmazaný)'), 44)
                .' · '.number_format($c->score, 1).' % · '.$c->reason,
        ])->all();

        return [$query->clone()->count(), $examples];
    }

    /**
     * @param  array<int, string>  $areaNames
     * @return array<string, mixed>
     */
    private function example(Node $node, array $areaNames, ?string $note): array
    {
        return [
            'id' => $node->id,
            'label' => $this->shorten((string) $node->label, 60),
            'type' => $node->type,
            'area' => $node->area_id !== null ? ($areaNames[$node->area_id] ?? null) : null,
            'strength' => (float) $node->strength,
            'note' => $note,
        ];
    }

    /** @param  array<string, mixed>  $report */
    private function renderText(array $report): void
    {
        $this->line('');
        $this->line("Hygiena pamäti · {$report['nodes']} uzlov, {$report['edges']} hrán · "
            .now()->format('j. n. Y H:i'));
        $this->line('');

        $this->table(
            ['trieda', 'uzlov', '%', 'váha', 'čo to stojí AI'],
            collect($report['classes'])->map(fn (array $c) => [
                $c['class'],
                $c['count'],
                number_format($c['share'], 1),
                $c['weight'],
                $c['costs'],
            ])->all(),
        );

        $burden = collect($report['classes'])->sortByDesc('burden')->take(3)
            ->map(fn (array $c) => "{$c['class']} ({$c['burden']})")->implode(', ');

        $this->line("Najväčšia záťaž (váha × počet): {$burden}");
        $this->line("Uzlov s aspoň jedným nálezom: {$report['dirty_nodes']} z {$report['nodes']}.");

        if ($report['worst'] !== []) {
            $this->line('');
            $this->line('Najdrahšie jednotlivé uzly:');
            foreach ($report['worst'] as $node) {
                $this->line("  [{$node['id']}] {$node['label']} · ".implode(' + ', $node['classes'])
                    .' · sila '.(int) $node['strength']);
            }
        }

        foreach ($report['classes'] as $class) {
            if ($class['examples'] === []) {
                continue;
            }

            $this->line('');
            $this->line("{$class['class']} — {$class['title']} ({$class['count']})");

            foreach ($class['examples'] as $example) {
                $tail = $example['note'] !== null ? "  ← {$example['note']}" : '';
                $this->line("  [{$example['id']}] {$example['label']}"
                    .' · '.($example['type'] ?? '?')
                    .' · '.($example['area'] ?? 'bez oblasti')
                    .$tail);
            }
        }

        if ($this->option('fix')) {
            return;
        }

        $this->line('');
        $this->line('Nič som nezmenil. Ďalší krok je rozhodnutie človeka:');
        $this->line('  php artisan mind:duplicates            frontu duplicít vybaviť ručne');
        $this->line('  php artisan mind:hygiene --fix         náhľad opravy labelov (zápis až s --force)');
        $this->line('  mind_rename / mind_move                jednotlivé uzly cez MCP');
    }

    /**
     * Náhľad a zápis dvoch VRATNÝCH tried. Nič iné sa tu opravovať nebude:
     * useknutý prompt sa nedá uhádnuť a slug nemá čo prezradiť, takže ich
     * prepis by bola výmysel, nie hygiena.
     */
    private function runFix(MindService $mind): void
    {
        $candidates = [];
        $collisions = [];

        Node::query()->select(['id', 'label', 'type'])->orderBy('id')->chunk(500, function ($nodes) use (&$candidates, &$collisions) {
            foreach ($nodes as $node) {
                $clean = $this->cleanLabel((string) $node->label);

                if ($clean === '' || $clean === (string) $node->label) {
                    continue;
                }

                // Prepis na label, ktorý už niekto má, by vyrobil duplicitu —
                // a tá sa rieši frontou, nie premenovaním.
                //
                // `findExact()` sa tu použiť NEDÁ, hoci to tak vyzerá: slug je
                // odvodený z labelu, takže „# Smernica: X" a „Smernica: X" majú
                // ten istý slug a findExact vráti uzol sám na seba (a pri
                // skutočnom dvojníkovi vráti null, lebo má dve zhody). Kolízia
                // je preto výslovne INÝ uzol.
                if ($this->labelTaken($node, $clean)) {
                    $collisions[] = [$node, $clean];

                    continue;
                }

                $candidates[] = [$node, $clean];
            }
        });

        $this->say('');

        if ($candidates === [] && $collisions === []) {
            $this->say('Fix: žiadny label netreba čistiť.', 'info');

            return;
        }

        foreach ($candidates as [$node, $clean]) {
            $this->say("  [{$node->id}]");
            $this->say("  - {$node->label}");
            $this->say("  + {$clean}");
        }

        foreach ($collisions as [$node, $clean]) {
            $this->say("  [{$node->id}] „{$clean}“ už existuje — nechávam tak, rieš cez mind:duplicates.", 'warn');
        }

        if (! $this->option('force')) {
            $this->say('');
            $this->say('Náhľad. Nič som nezapísal — zápis až s --force.', 'warn');

            return;
        }

        foreach ($candidates as [$node, $clean]) {
            $mind->rename($node, $clean);
        }

        $this->say('Fix: opravených '.count($candidates).' labelov.', 'info');
    }

    /**
     * Riadok náhľadu opravy. Pri `--json` ide na chybový výstup, aby stdout
     * ostal parsovateľný JSON — a aby človek náhľad aj tak videl. Zamlčať ho
     * nemôžem: zápis, ktorý nikto nevidel, je presne to, čo tento príkaz nerobí.
     *
     * Pozor pri testoch: `Artisan::call()` píše do BufferedOutput, ktorý žiadny
     * druhý kanál nemá, takže tam náhľad z stdout NEODÍDE. Kombinácia
     * `--json --fix` preto nie je súčasťou strojového kontraktu.
     */
    private function say(string $text, string $style = 'line'): void
    {
        if ($this->option('json')) {
            $this->getOutput()->getErrorOutput()->writeln($text);

            return;
        }

        $this->{$style}($text);
    }

    /** Drží už iný živý uzol rovnakého typu tento label (alebo jeho slug)? */
    private function labelTaken(Node $node, string $label): bool
    {
        return Node::query()
            ->where('id', '!=', $node->id)
            ->where('type', $node->type)
            ->where(fn ($q) => $q
                ->whereRaw('LOWER(label) = ?', [mb_strtolower($label)])
                ->orWhere('slug', Str::slug($label)))
            ->exists();
    }

    /**
     * Zhodí markdownové ozdoby a zlepí biele znaky. Prefixy sa berú prvé —
     * odrážka „* " sa musí odstrániť skôr, než z reťazca zmiznú hviezdičky
     * tučného písma, inak by z „* **Docker**" ostalo „* Docker".
     */
    private function cleanLabel(string $label): string
    {
        $out = preg_replace('/^\s*(?:#{1,6}|[-*+]|>)\s+/u', '', $label) ?? $label;
        $out = str_replace(['**', '`'], '', $out);
        $out = preg_replace('/\s+/u', ' ', $out) ?? $out;

        return trim($out);
    }

    /** @param  array<string, mixed>  $report */
    private function writeFile(array $report): string
    {
        $lines = [
            '# Hygiena pamäti — '.now()->format('j. n. Y H:i'),
            '',
            "Sieť: **{$report['nodes']}** uzlov, **{$report['edges']}** hrán. "
                ."Uzlov s aspoň jedným nálezom: **{$report['dirty_nodes']}**.",
            '',
            'Prahy: popis > '.$report['thresholds']['desc_chars'].' znakov, tagy > '
                .$report['thresholds']['tag_cap'].', zaradenie podľa '
                .$report['thresholds']['misfiled_min_neighbours'].'+ susedov a '
                .round(100 * $report['thresholds']['misfiled_share']).' % väčšiny.',
            '',
            '| trieda | uzlov | % | váha | čo to stojí AI |',
            '|---|---:|---:|---:|---|',
        ];

        foreach ($report['classes'] as $class) {
            $lines[] = "| {$class['class']} | {$class['count']} | ".number_format($class['share'], 1)
                ." | {$class['weight']} | {$class['costs']} |";
        }

        if ($report['worst'] !== []) {
            $lines[] = '';
            $lines[] = '## Najdrahšie jednotlivé uzly';
            $lines[] = '';

            foreach ($report['worst'] as $node) {
                $lines[] = "- `[{$node['id']}]` {$node['label']} — ".implode(' + ', $node['classes'])
                    .', sila '.(int) $node['strength'];
            }
        }

        foreach ($report['classes'] as $class) {
            if ($class['examples'] === []) {
                continue;
            }

            $lines[] = '';
            $lines[] = "## {$class['class']} — {$class['title']} ({$class['count']})";
            $lines[] = '';

            foreach ($class['examples'] as $example) {
                $lines[] = "- `[{$example['id']}]` {$example['label']} · ".($example['type'] ?? '?')
                    .' · '.($example['area'] ?? 'bez oblasti')
                    .($example['note'] !== null ? " — {$example['note']}" : '');
            }
        }

        $lines[] = '';
        $lines[] = '> Príkaz nič nezmazal ani neprepísal. Zlučovanie ide cez `mind:duplicates`, '
            .'premenovanie cez `mind_rename`, presun cez `mind_move`.';
        $lines[] = '';

        $path = storage_path('app/hygiene-'.now()->format('Y-m-d').'.md');

        if (! is_dir(dirname($path))) {
            mkdir(dirname($path), 0775, true);
        }

        file_put_contents($path, implode("\n", $lines));

        return $path;
    }

    private function shorten(string $value, int $chars): string
    {
        return (string) Str::limit(preg_replace('/\s+/u', ' ', $value) ?? $value, $chars);
    }
}
