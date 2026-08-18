<?php

namespace App\Http\Controllers;

use App\Models\Node;
use App\Services\MindService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * "Prompt builder / smernica pre Claude" — Hades poskladá pre danú úlohu
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

    /** Pasca je pre AI najcennejší uzol v smernici — dostane vlastnú sekciu. */
    protected const CAP_PITFALLS = 8;

    /** Skilly bez .md sú záchranná sieť, nie hlavný obsah — vlastný, nižší strop. */
    protected const CAP_SKILLS_NO_FILE = 8;

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
        $noise = [];          // id => kód odpadovosti (raw-prompt, markdown, slug, stub)
        $searchIds = [];
        if ($task !== '') {
            foreach ($mind->searchNodes($task, self::SEARCH_LIMIT) as $row) {
                /** @var Node $n */
                $n = $row['node'];
                $searchIds[] = $n->id;
                if (! empty($row['snippet'])) {
                    $snippets[$n->id] = $row['snippet'];
                }
                if (! empty($row['noise'])) {
                    $noise[$n->id] = $row['noise'];
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
        $pitfalls = [];

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

                // Odpadový uzol do promptu nepatrí. Namerané na tomto dopyte:
                // zo ôsmich „kľúčových faktov" boli štyri surové prompty
                // („Potrebujem vytvoriť aplikáciu ktorú nasadíme do dockeru a"),
                // teda polovica sekcie bola šum. Ručný výber má prednosť —
                // keď si uzol vybral človek, chce ho tam mať.
                if (! $isManual && isset($noise[$id])) {
                    continue;
                }

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

                // Pasca ide pred typ: „neopakuj túto chybu" je pre AI silnejší
                // pokyn než „toto je skill" a v zozname skillov sa strácala.
                if ($node->certainty === 'pasca') {
                    $pitfalls[] = [
                        'id' => $node->id,
                        'label' => $node->label,
                        'path' => $this->skillPath($node),
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
        $pitfalls = array_slice($pitfalls, 0, self::CAP_PITFALLS);

        // Skilly bez súboru sa už nezahadzujú, ale nesmú prompt zaplaviť: pri
        // „reverb websockety docker nasadenie" ich hľadanie našlo trinásť.
        $skills = $this->capSkillsWithoutFile($skills);

        $suggested = [
            'skills' => $skills,
            'pitfalls' => $pitfalls,
            'projects' => $projects,
            'facts' => $facts,
            'rules' => $rules,
        ];

        return response()->json([
            'task' => $task,
            'suggested' => $suggested,
            'markdown' => $this->buildMarkdown($task, $skills, $projects, $facts, $rules, $pitfalls),
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
     * Poskladá štruktúrovanú markdown smernicu.
     *
     * Toto je doslova prompt pre Claude Code, takže platia iné pravidlá než pre
     * text pre človeka:
     *
     *  - Sekcia „Kde nájdeš" zmizla — bola to riadok po riadku kópia sekcií
     *    „Použi tieto skilly" a „Súvisiace projekty", teda ~30 % promptu za nulovú
     *    informáciu. Cesty sú pri skilloch tam, kde sa čítajú.
     *  - Namiesto vety „táto smernica hovorí, kde nájdeš…" (opis sama seba) je
     *    „Ako s tým pracovať" — konkrétne pokyny, a len tie, na ktoré v smernici
     *    naozaj niečo je.
     *  - Pasce dostali vlastnú sekciu. „Neopakuj túto chybu" je najsilnejší
     *    poznatok, aký Hades má, a doteraz sa mlčky mieša medzi skilly.
     *  - Neoverené skilly (bez .md na disku) sa už nezahadzujú. Uzol síce nemá
     *    súbor, ale má popis — a to je viac než nič.
     *
     * @param  array<int, array{id:int,label:string,path:?string,verified:bool,snippet:?string}>  $skills
     * @param  array<int, array{id:int,label:string,info:string}>  $projects
     * @param  array<int, array{id:int,label:string,snippet:?string}>  $facts
     * @param  array<int, array{id:int,label:string,snippet:?string}>  $rules
     * @param  array<int, array{id:int,label:string,path:?string,snippet:?string}>  $pitfalls
     */
    protected function buildMarkdown(
        string $task,
        array $skills,
        array $projects,
        array $facts,
        array $rules,
        array $pitfalls = [],
    ): string {
        $taskLine = $task !== '' ? $task : 'Nešpecifikovaná úloha';
        $verifiedSkills = array_values(array_filter(
            $skills,
            fn ($s) => $s['verified'] && ! empty($s['path'])
        ));
        $otherSkills = array_values(array_filter(
            $skills,
            fn ($s) => ! ($s['verified'] && ! empty($s['path']))
        ));

        $lines = [];
        $lines[] = '# Smernica: '.$taskLine;
        $lines[] = '';
        $lines[] = '## Zadanie';
        $lines[] = $taskLine;
        $lines[] = '';
        $lines[] = '## Ako s tým pracovať';
        foreach ($this->howToLines($verifiedSkills, $projects, $pitfalls) as $line) {
            $lines[] = '- '.$line;
        }
        $lines[] = '';

        if (! empty($verifiedSkills)) {
            $lines[] = '## Použi tieto skilly';
            foreach ($verifiedSkills as $s) {
                $lines[] = '- '.$s['label'].' — `'.$s['path'].'`';
            }
            $lines[] = '';
        }

        if (! empty($pitfalls)) {
            $lines[] = '## Pasce — čo nerobiť';
            foreach ($pitfalls as $t) {
                $snip = $this->oneLine($t['snippet']);
                $path = ! empty($t['path']) ? ' (`'.$t['path'].'`)' : '';
                $lines[] = '- '.$t['label'].$path.($snip !== '' ? ': '.$snip : '');
            }
            $lines[] = '';
        }

        if (! empty($projects)) {
            $lines[] = '## Súvisiace projekty';
            foreach ($projects as $p) {
                $lines[] = '- '.$p['label'].$this->infoSuffix($p['info'] ?? '');
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

        if (! empty($otherSkills)) {
            $lines[] = '## Ďalšie relevantné skilly (bez .md v repo)';
            foreach ($otherSkills as $s) {
                $snip = $this->oneLine($s['snippet']);
                $lines[] = '- '.$s['label'].($snip !== '' ? ': '.$snip : '');
            }
            $lines[] = '';
        }

        return rtrim(implode("\n", $lines))."\n";
    }

    /**
     * Skilly s overenou .md cestou ostávajú všetky, tie bez súboru len do stropu.
     * Poradie sa nemení, takže ručný výber (vpredu) prežije.
     *
     * @param  array<int, array{id:int,label:string,path:?string,verified:bool,snippet:?string}>  $skills
     * @return array<int, array{id:int,label:string,path:?string,verified:bool,snippet:?string}>
     */
    protected function capSkillsWithoutFile(array $skills): array
    {
        $seen = 0;

        return array_values(array_filter($skills, function (array $s) use (&$seen): bool {
            if ($s['verified'] && ! empty($s['path'])) {
                return true;
            }

            return ++$seen <= self::CAP_SKILLS_NO_FILE;
        }));
    }

    /**
     * Pokyny „Ako s tým pracovať" — len tie, na ktoré v smernici naozaj niečo je.
     * Pokyn na sekciu, ktorá v dokumente nie je, je horší než žiadny: AI ju
     * začne hľadať.
     *
     * @return array<int, string>
     */
    protected function howToLines(array $verifiedSkills, array $projects, array $pitfalls): array
    {
        $out = ['Toto je kontext z Hadesa (trvalá pamäť Claude Code), nie zadanie samo o sebe.'];

        if (! empty($verifiedSkills)) {
            $out[] = 'Skilly nižšie majú cestu k .md — prečítaj si ich pred prvým riadkom kódu.';
        }
        if (! empty($pitfalls)) {
            $out[] = 'Pasce sú overené chyby z minulosti; neopakuj ich.';
        }
        if (! empty($projects)) {
            $out[] = 'Pri projektoch je adresár alebo popis — over stav priamo v ňom.';
        }

        $out[] = 'Keď niečo chýba, dotiahni si to MCP nástrojmi `mind_recall` a `mind_read`.';

        return $out;
    }

    /** Adresár do backtickov, prózu nie — AI má vidieť, čo je cesta. */
    protected function infoSuffix(string $info): string
    {
        $info = trim($info);
        if ($info === '') {
            return '';
        }

        return preg_match('#^([A-Za-z]:[\\\\/]|/)#', $info) === 1
            ? ' — `'.$info.'`'
            : ': '.$this->oneLine($info);
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

    /** Cesta k .md skillu — jeden zdroj pravdy je {@see MindService::sourcePathOf}. */
    protected function skillPath(Node $node): ?string
    {
        return app(MindService::class)->sourcePathOf($node);
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

        foreach ((array) config('hades.project_dirs', []) as $name => $dir) {
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
        return (string) config('hades.directives_path', base_path('directives'));
    }
}
