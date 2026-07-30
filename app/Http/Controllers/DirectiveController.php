<?php

namespace App\Http\Controllers;

use App\Models\Node;
use App\Services\MindService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * "Prompt builder / smernica pre Claude" — AuraAI poskladá pre danú úlohu
 * smernicu, ktorá Claudovi povie, KDE ČO NÁJDE: overené skilly (.md cesty),
 * súvisiace projekty (adresáre), kľúčové fakty a pravidlá/preferencie.
 *
 * Len čítanie mozgu + zápis hotovej smernice do directives/*.md. Nič v mozgu
 * nemení, nezvyšuje silu, neposiela pulz.
 */
class DirectiveController extends Controller
{
    /** Koľko relevantných uzlov nájsť v mozgu pre danú úlohu. */
    protected const SEARCH_LIMIT = 30;

    /** Stropy na kategórie, aby smernica ostala čitateľná. */
    protected const CAP_SKILLS = 20;

    protected const CAP_PROJECTS = 10;

    protected const CAP_FACTS = 15;

    protected const CAP_RULES = 10;

    /**
     * POST /api/directive/build {task?: string, node_ids?: int[]}
     * Poskladá NÁVRH smernice: nájde relevantné uzly, roztriedi ich na skilly /
     * projekty / fakty / pravidlá, overí cesty skillov na disku a vygeneruje
     * markdown. Vráti {task, suggested, markdown}.
     */
    public function build(Request $request, MindService $mind): JsonResponse
    {
        $validated = $request->validate([
            'task' => 'nullable|string|max:2000',
            'node_ids' => 'nullable|array|max:50',
            'node_ids.*' => 'integer',
        ]);

        $task = trim((string) ($validated['task'] ?? ''));
        $manualIds = array_values(array_unique(array_map('intval', $validated['node_ids'] ?? [])));

        // 1) kandidáti z SK-aware hľadania (ak je zadaná úloha)
        $snippets = [];       // id => snippet z hľadania
        $searchIds = [];
        if ($task !== '') {
            foreach ($mind->searchNodes($task, self::SEARCH_LIMIT) as $row) {
                /** @var Node $n */
                $n = $row['node'];
                $searchIds[] = $n->id;
                if (! empty($row['snippet'])) {
                    $snippets[$n->id] = $row['snippet'];
                }
            }
        }

        // 2) ručný výber ide navrch a je vždy zahrnutý (uprednostnený)
        $manualSet = array_flip($manualIds);
        $allIds = array_values(array_unique(array_merge($manualIds, $searchIds)));

        $skills = [];
        $projects = [];
        $facts = [];
        $rules = [];

        if (! empty($allIds)) {
            $nodes = Node::with(['area', 'department'])
                ->whereIn('id', $allIds)
                ->get()
                ->keyBy('id');

            foreach ($allIds as $id) {
                $node = $nodes->get($id);
                if (! $node) {
                    continue;
                }

                $isManual = isset($manualSet[$id]);
                $areaSlug = $node->area?->slug;

                // pravidlá / preferencie — jadro alebo oblasť "osobne-preferencie"
                if ($node->type === 'core' || $areaSlug === 'osobne-preferencie') {
                    $rules[] = [
                        'id' => $node->id,
                        'label' => $node->label,
                        'snippet' => $this->snippet($node, $snippets),
                    ];

                    continue;
                }

                if ($node->type === 'skill') {
                    $path = $this->skillPath($node);
                    $skills[] = [
                        'id' => $node->id,
                        'label' => $node->label,
                        'path' => $path,
                        'verified' => $path !== null && $this->verifyPath($path),
                        'snippet' => $this->snippet($node, $snippets),
                    ];

                    continue;
                }

                if ($node->type === 'project') {
                    $projects[] = [
                        'id' => $node->id,
                        'label' => $node->label,
                        'info' => $this->projectInfo($node),
                    ];

                    continue;
                }

                // fakty — memory alebo non-core bez zdroja; ručne vybrané vždy,
                // z hľadania už prešli tvrdým prahom relevancie
                if ($node->type === 'memory' || $node->source === null) {
                    $facts[] = [
                        'id' => $node->id,
                        'label' => $node->label,
                        'snippet' => $this->snippet($node, $snippets),
                    ];
                }
            }
        }

        // stropy — ručný výber je vpredu, takže sa nikdy neoreže
        $skills = array_slice($skills, 0, self::CAP_SKILLS);
        $projects = array_slice($projects, 0, self::CAP_PROJECTS);
        $facts = array_slice($facts, 0, self::CAP_FACTS);
        $rules = array_slice($rules, 0, self::CAP_RULES);

        $suggested = [
            'skills' => $skills,
            'projects' => $projects,
            'facts' => $facts,
            'rules' => $rules,
        ];

        return response()->json([
            'task' => $task,
            'suggested' => $suggested,
            'markdown' => $this->buildMarkdown($task, $skills, $projects, $facts, $rules),
        ]);
    }

    /**
     * POST /api/directive/save {name, markdown} → zapíše directives/<slug>.md.
     * Vráti { path } (relatívnu cestu v repo).
     */
    public function save(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:200',
            'markdown' => 'required|string|max:100000',
        ]);

        $dir = $this->directivesPath();
        if (! is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }

        $slug = Str::slug($validated['name']);
        if ($slug === '') {
            $slug = 'smernica-'.now()->format('Ymd-His');
        }

        $full = rtrim($dir, '/\\').DIRECTORY_SEPARATOR.$slug.'.md';
        file_put_contents($full, $validated['markdown']);

        return response()->json(['path' => 'directives/'.$slug.'.md']);
    }

    /**
     * GET /api/directives → zoznam uložených smerníc { name, path, title }.
     * title = prvý riadok súboru (nadpis bez '#'). Najnovšie prvé.
     */
    public function index(): JsonResponse
    {
        $dir = $this->directivesPath();
        $out = [];

        foreach (glob(rtrim($dir, '/\\').'/*.md') ?: [] as $file) {
            $first = '';
            $fh = @fopen($file, 'r');
            if ($fh) {
                $line = fgets($fh);
                fclose($fh);
                $first = trim(ltrim((string) $line, "# \t"));
            }

            $out[] = [
                'name' => pathinfo($file, PATHINFO_FILENAME),
                'path' => 'directives/'.basename($file),
                'title' => $first,
                'mtime' => @filemtime($file) ?: 0,
            ];
        }

        // najnovšie prvé podľa času úpravy
        usort($out, fn ($a, $b) => $b['mtime'] <=> $a['mtime']);
        foreach ($out as &$row) {
            unset($row['mtime']);
        }

        return response()->json(['directives' => $out]);
    }

    /**
     * GET /api/directive/{name} → obsah uloženej smernice pre znovuotvorenie v UI.
     * name je slug (bez prípony); cesta je chránená proti path traversal.
     */
    public function show(string $name): JsonResponse
    {
        $slug = Str::slug($name);
        if ($slug === '') {
            return response()->json(['message' => 'Neplatný názov.'], 404);
        }

        $full = rtrim($this->directivesPath(), '/\\').DIRECTORY_SEPARATOR.$slug.'.md';
        if (! is_file($full)) {
            return response()->json(['message' => 'Smernica sa nenašla.'], 404);
        }

        return response()->json([
            'name' => $slug,
            'path' => 'directives/'.$slug.'.md',
            'markdown' => (string) @file_get_contents($full),
        ]);
    }

    /**
     * GET /api/directive/templates → rýchle štarty. Každá šablóna predvyplní
     * task a UI ju hneď spustí cez /api/directive/build.
     */
    public function templates(): JsonResponse
    {
        return response()->json(['templates' => [
            [
                'name' => 'Nová Aura appka',
                'task' => 'nová Aura appka Docker Node Express MariaDB dizajn systém tokeny frontend',
                'hint' => 'Postav ďalšiu internú Aura appku konzistentne s dizajn systémom.',
            ],
            [
                'name' => 'Eshop feature',
                'task' => 'eshop feature admin pricing cenotvorba produkt sklad checkout',
                'hint' => 'Nová funkcia do e-shopu — admin, pricing, sklad, checkout.',
            ],
            [
                'name' => 'Marketingová kampaň',
                'task' => 'marketingová kampaň Meta Google Ads copywriting email SEO funnel',
                'hint' => 'Priprav kampaň naprieč kanálmi — copy, ads, email, meranie.',
            ],
            [
                'name' => 'Banner',
                'task' => 'banner studio generovanie bannerov dizajn brand grafika formáty',
                'hint' => 'Vytvor bannery cez Banner Studio a brand systém.',
            ],
            [
                'name' => 'Dizajn',
                'task' => 'dizajn systém UI UX farby typografia komponenty accessibility motion',
                'hint' => 'Dizajnová práca — systém, komponenty, prístupnosť, pohyb.',
            ],
        ]]);
    }

    /**
     * Poskladá štruktúrovanú markdown smernicu. Do "Použi tieto skilly" a
     * "Kde nájdeš" idú LEN overené cesty (file_exists na disku).
     *
     * @param  array<int, array{id:int,label:string,path:?string,verified:bool,snippet:?string}>  $skills
     * @param  array<int, array{id:int,label:string,info:string}>  $projects
     * @param  array<int, array{id:int,label:string,snippet:?string}>  $facts
     * @param  array<int, array{id:int,label:string,snippet:?string}>  $rules
     */
    protected function buildMarkdown(string $task, array $skills, array $projects, array $facts, array $rules): string
    {
        $taskLine = $task !== '' ? $task : 'Nešpecifikovaná úloha';
        $verifiedSkills = array_values(array_filter(
            $skills,
            fn ($s) => $s['verified'] && ! empty($s['path'])
        ));

        $lines = [];
        $lines[] = '# Smernica: '.$taskLine;
        $lines[] = '';
        $lines[] = '## Kontext';
        $lines[] = $this->contextSentence($task, $verifiedSkills, $projects);
        $lines[] = '';

        if (! empty($verifiedSkills)) {
            $lines[] = '## Použi tieto skilly';
            foreach ($verifiedSkills as $s) {
                $lines[] = '- '.$s['label'].' — `'.$s['path'].'`';
            }
            $lines[] = '';
        }

        if (! empty($projects)) {
            $lines[] = '## Súvisiace projekty';
            foreach ($projects as $p) {
                $info = trim((string) ($p['info'] ?? ''));
                $lines[] = '- '.$p['label'].($info !== '' ? ': '.$info : '');
            }
            $lines[] = '';
        }

        if (! empty($facts)) {
            $lines[] = '## Kľúčové fakty';
            foreach ($facts as $f) {
                $snip = $this->oneLine($f['snippet']);
                $lines[] = '- '.$f['label'].($snip !== '' ? ': '.$snip : '');
            }
            $lines[] = '';
        }

        if (! empty($rules)) {
            $lines[] = '## Pravidlá a preferencie';
            foreach ($rules as $r) {
                $snip = $this->oneLine($r['snippet']);
                $lines[] = '- '.$r['label'].($snip !== '' ? ': '.$snip : '');
            }
            $lines[] = '';
        }

        // "Kde nájdeš" — tématické odkazy len na overené cesty a známe adresáre
        $where = [];
        foreach ($verifiedSkills as $s) {
            $where[] = '- '.$s['label'].' → `'.$s['path'].'`';
        }
        foreach ($projects as $p) {
            $info = trim((string) ($p['info'] ?? ''));
            if ($info !== '') {
                $where[] = '- '.$p['label'].' → '.$info;
            }
        }
        if (! empty($where)) {
            $lines[] = '## Kde nájdeš';
            $lines = array_merge($lines, $where);
            $lines[] = '';
        }

        return rtrim(implode("\n", $lines))."\n";
    }

    /** 1-2 vety kontextu podľa toho, čo sa do smernice dostalo. */
    protected function contextSentence(string $task, array $verifiedSkills, array $projects): string
    {
        $subject = $task !== '' ? '„'.$task.'"' : 'túto úlohu';
        $parts = [];
        if (! empty($verifiedSkills)) {
            $parts[] = count($verifiedSkills).'× skill';
        }
        if (! empty($projects)) {
            $parts[] = count($projects).'× projekt';
        }
        $have = ! empty($parts) ? ' Zahŕňa '.implode(' a ', $parts).'.' : '';

        return 'Táto smernica hovorí, kde v '.config('auraai.name', 'AuraAI')
            .' nájdeš relevantné znalosti pre '
            .$subject.'.'.$have.' Použi uvedené zdroje ako kontext skôr, než začneš.';
    }

    /** Snippet uzla: z hľadania, inak skrátený popis. */
    protected function snippet(Node $node, array $snippets): ?string
    {
        if (! empty($snippets[$node->id])) {
            return $snippets[$node->id];
        }

        $desc = trim((string) $node->description);

        return $desc !== '' ? Str::limit($this->oneLine($desc), 160) : null;
    }

    /** Zbalí text na jeden riadok a skráti — pre odrážky v smernici. */
    protected function oneLine(?string $text): string
    {
        $t = trim(preg_replace('/\s+/u', ' ', (string) $text));

        return $t === '' ? '' : Str::limit($t, 160);
    }

    /** Cesta k .md skillu — z meta.path, inak odvodená z external_key. */
    protected function skillPath(Node $node): ?string
    {
        $meta = is_array($node->meta) ? $node->meta : [];
        if (! empty($meta['path']) && is_string($meta['path'])) {
            return $meta['path'];
        }

        if (is_string($node->external_key) && str_starts_with($node->external_key, 'skill:')) {
            return 'skills/'.substr($node->external_key, strlen('skill:')).'.md';
        }

        return null;
    }

    /** Existuje daná .md cesta v repo? Chránené proti path traversal. */
    protected function verifyPath(string $path): bool
    {
        if ($path === '' || str_contains($path, '..')) {
            return false;
        }

        return is_file(base_path($path));
    }

    /** Info o projekte pre smernicu — známy adresár (config), inak cwd/popis/oblasť. */
    protected function projectInfo(Node $node): string
    {
        $label = mb_strtolower(trim((string) $node->label));

        foreach ((array) config('auraai.project_dirs', []) as $name => $dir) {
            if (mb_strtolower((string) $name) === $label) {
                return (string) $dir;
            }
        }

        $meta = is_array($node->meta) ? $node->meta : [];
        if (! empty($meta['cwd']) && is_string($meta['cwd'])) {
            return $meta['cwd'];
        }

        $desc = trim((string) $node->description);
        if ($desc !== '') {
            return $this->oneLine($desc);
        }

        return $node->area?->name ? 'oblasť: '.$node->area->name : '';
    }

    /** Absolútna cesta k priečinku smerníc (config alebo base_path/directives). */
    protected function directivesPath(): string
    {
        return (string) config('auraai.directives_path', base_path('directives'));
    }
}
