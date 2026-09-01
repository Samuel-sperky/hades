<?php

namespace App\Serializers\Screen;

use App\Models\Node;
use App\Serializers\ScreenSerializer;
use App\Services\MindService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

/**
 * Obrazovka Smernica — prompt builder.
 *
 * Jeden zdroj pre `POST /api/directive/build`, `GET /api/directive/templates`,
 * `GET /api/directives` (človek) aj pre `mind_directive` (AI).
 *
 * **Prečo táto trieda vznikla.** Smernica bola najhorší rozchod plôch v celej
 * appke: server posielal hotový `markdown`, prehliadač ho zahodil a poskladal si
 * vlastný (`smernica.js:216–279`), pričom komentár v kóde to sám priznával
 * („keď meníš jedno, zmeň aj druhé"). Nebola to teoretická hrozba — namerané na
 * troch reálnych úlohách sa texty rozišli na 15–23 z ~45 riadkov (`Str::limit`
 * zakončuje `...`, JS `…`), takže smernica, ktorú si človek skopíroval do Claude
 * Code, nebola tá, ktorú by dostala AI. Odteraz **skladá server, UI zobrazuje.**
 *
 * **Čo server dovtedy nevedel, a preto to sem pribudlo, nezahodilo sa:** človek
 * si v návrhu položky odškrtáva a náhľad musí zmiznuté položky vynechať. To je
 * `include_ids` — deklarovaný výber. Bez neho by „server skladá" znamenalo, že
 * checkboxy prestanú fungovať, a to nie je zjednotenie, ale strata funkcie.
 *
 * `suggested` je vždy CELÝ návrh (aj odškrtnuté položky) — je to to, čo Hades
 * našiel. Výber nesie `selected_ids` a markdown; keby `suggested` filtrovalo,
 * odškrtnutá položka by z obrazovky navždy zmizla a nedala by sa vrátiť.
 */
class SmernicaScreen extends ScreenSerializer
{
    /** Koľko relevantných uzlov nájsť v mozgu pre danú úlohu. */
    public const SEARCH_LIMIT = 30;

    /** Stropy na kategórie, aby smernica ostala čitateľná. */
    public const CAP_SKILLS = 20;

    public const CAP_PROJECTS = 10;

    public const CAP_FACTS = 15;

    public const CAP_RULES = 10;

    /** Pasca je pre AI najcennejší uzol v smernici — dostane vlastnú sekciu. */
    public const CAP_PITFALLS = 8;

    /** Skilly bez .md sú záchranná sieť, nie hlavný obsah — vlastný, nižší strop. */
    public const CAP_SKILLS_NO_FILE = 8;

    /** Sekcie návrhu v poradí, v akom ich číta obrazovka aj markdown. */
    public const SECTIONS = ['skills', 'pitfalls', 'projects', 'facts', 'rules'];

    /**
     * Ako dlho si držať poskladaný návrh pre dopočet markdownu k inému výberu.
     *
     * Dva dôvody, oba vecné. (1) Cena: preklik jedného checkboxu by inak platil
     * celé hľadanie vrátane vektorizácie dopytu (~200 ms), a to pri každom kliku.
     * (2) Správnosť: **Hades je živý.** Medzi poskladaním a odškrtnutím sa môže
     * naučiť uzol a to isté hľadanie vráti iný snippet — náhľad by sa potom líšil
     * od zoznamu vedľa neho. Keď cache vypadne, dopočet sa poctivo prepočíta;
     * `include_ids` aj tak nepustí do markdownu nič, čo nie je na obrazovke.
     */
    private const REUSE_TTL = 120;

    /** @var array<string, mixed>|null */
    private ?array $memo = null;

    /**
     * @param  array<string, mixed>  $params  task, node_ids, include_ids
     */
    public function __construct(private array $params = []) {}

    public function data(): array
    {
        $task = $this->task();
        $suggested = $this->suggested();
        $selected = $this->selectedIds($suggested);

        return [
            'task' => $task,
            'suggested' => $suggested,
            'counts' => $this->counts($suggested),
            'selected_ids' => $selected,
            'markdown' => $this->markdown($task, $this->pick($suggested, $selected)),
            'templates' => $this->templates(),
            'directives' => $this->saved(),
        ];
    }

    /**
     * Pre AI je celý zmysel tejto obrazovky `markdown` — hotový prompt ku
     * konkrétnej úlohe. `suggested` je surovina, z ktorej ten prompt vznikol,
     * takže by sa každý uzol platil dvakrát; `templates` sú tlačidlá pre oko
     * a uložené smernice si vie AI vyžiadať zvlášť. `counts` ostáva: hovorí,
     * koľko toho Hades k úlohe vôbec vie, čo z markdownu samého nevidno.
     */
    public function fieldsForAi(): array
    {
        return ['task', 'counts', 'markdown'];
    }

    // ---- vstupy ------------------------------------------------------------

    private function task(): string
    {
        return trim((string) ($this->params['task'] ?? ''));
    }

    /** @return list<int> */
    private function manualIds(): array
    {
        return array_values(array_unique(array_map('intval', (array) ($this->params['node_ids'] ?? []))));
    }

    /** Výber človeka. `null` = „všetko, čo Hades našiel". @return list<int>|null */
    private function includeIds(): ?array
    {
        if (! array_key_exists('include_ids', $this->params) || $this->params['include_ids'] === null) {
            return null;
        }

        return array_values(array_unique(array_map('intval', (array) $this->params['include_ids'])));
    }

    // ---- návrh -------------------------------------------------------------

    /**
     * Roztriedený návrh: skilly / pasce / projekty / fakty / pravidlá.
     *
     * @return array<string, list<array<string, mixed>>>
     */
    private function suggested(): array
    {
        if ($this->memo !== null) {
            return $this->memo;
        }

        // Dopočet markdownu k inému výberu smie siahnuť po tom istom návrhu —
        // viď REUSE_TTL. Prvé poskladanie ho naopak vždy prepočíta, inak by
        // „Poskladať" po naučení nového uzla vracalo starý stav mozga.
        if ($this->includeIds() !== null) {
            $cached = Cache::get($this->reuseKey());

            if (is_array($cached)) {
                return $this->memo = $cached;
            }
        }

        $suggested = $this->classify();

        Cache::put($this->reuseKey(), $suggested, self::REUSE_TTL);

        return $this->memo = $suggested;
    }

    /**
     * @return array<string, list<array<string, mixed>>>
     */
    private function classify(): array
    {
        $mind = app(MindService::class);
        $task = $this->task();
        $manualIds = $this->manualIds();

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

        return [
            'skills' => $skills,
            'pitfalls' => $pitfalls,
            'projects' => $projects,
            'facts' => $facts,
            'rules' => $rules,
        ];
    }

    /**
     * Id, ktoré sú naozaj v markdowne. Bez `include_ids` je to celý návrh —
     * teda presne to, čo obrazovka po poskladaní zaškrtne.
     *
     * Stropy sa uplatnili PRED týmto krokom zámerne: odškrtnutie položky nesmie
     * do smernice vtiahnuť uzol, ktorý strop odrezal a človek ho na obrazovke
     * nikdy nevidel.
     *
     * @param  array<string, list<array<string, mixed>>>  $suggested
     * @return list<int>
     */
    private function selectedIds(array $suggested): array
    {
        $all = [];
        foreach (self::SECTIONS as $section) {
            foreach ($suggested[$section] ?? [] as $item) {
                $all[] = (int) $item['id'];
            }
        }

        $include = $this->includeIds();

        return $include === null ? $all : array_values(array_intersect($all, $include));
    }

    /**
     * @param  array<string, list<array<string, mixed>>>  $suggested
     * @param  list<int>  $selected
     * @return array<string, list<array<string, mixed>>>
     */
    private function pick(array $suggested, array $selected): array
    {
        $keep = array_flip($selected);
        $out = [];

        foreach (self::SECTIONS as $section) {
            $out[$section] = array_values(array_filter(
                $suggested[$section] ?? [],
                static fn (array $item): bool => isset($keep[(int) $item['id']]),
            ));
        }

        return $out;
    }

    /**
     * @param  array<string, list<array<string, mixed>>>  $suggested
     * @return array<string, int>
     */
    private function counts(array $suggested): array
    {
        $counts = [];
        foreach (self::SECTIONS as $section) {
            $counts[$section] = count($suggested[$section] ?? []);
        }
        $counts['total'] = array_sum($counts);

        return $counts;
    }

    private function reuseKey(): string
    {
        return 'hades:directive:'.sha1($this->task().'|'.implode(',', $this->manualIds()));
    }

    // ---- markdown ----------------------------------------------------------

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
     * @param  array<string, list<array<string, mixed>>>  $picked
     */
    private function markdown(string $task, array $picked): string
    {
        $skills = $picked['skills'];
        $pitfalls = $picked['pitfalls'];
        $projects = $picked['projects'];
        $facts = $picked['facts'];
        $rules = $picked['rules'];

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
    private function capSkillsWithoutFile(array $skills): array
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
    private function howToLines(array $verifiedSkills, array $projects, array $pitfalls): array
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
    private function infoSuffix(string $info): string
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
    private function snippet(Node $node, array $snippets): ?string
    {
        if (! empty($snippets[$node->id])) {
            return $snippets[$node->id];
        }

        $desc = trim((string) $node->description);

        return $desc !== '' ? Str::limit($this->oneLine($desc), 160) : null;
    }

    /** Zbalí text na jeden riadok a skráti — pre odrážky v smernici. */
    private function oneLine(?string $text): string
    {
        $t = trim(preg_replace('/\s+/u', ' ', (string) $text));

        return $t === '' ? '' : Str::limit($t, 160);
    }

    /** Cesta k .md skillu — jeden zdroj pravdy je {@see MindService::sourcePathOf}. */
    private function skillPath(Node $node): ?string
    {
        return app(MindService::class)->sourcePathOf($node);
    }

    /** Existuje daná .md cesta v repo? Chránené proti path traversal. */
    private function verifyPath(string $path): bool
    {
        if ($path === '' || str_contains($path, '..')) {
            return false;
        }

        return is_file(base_path($path));
    }

    /** Info o projekte pre smernicu — známy adresár (config), inak cwd/popis/oblasť. */
    private function projectInfo(Node $node): string
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

    // ---- zvyšok obrazovky --------------------------------------------------

    /**
     * Rýchle štarty. Každá šablóna predvyplní task a UI ju hneď spustí.
     *
     * @return list<array{name: string, task: string, hint: string}>
     */
    private function templates(): array
    {
        return [
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
        ];
    }

    /**
     * Uložené smernice { name, path, title, saved_at }. title = prvý riadok súboru
     * (nadpis bez '#'). Najnovšie prvé.
     *
     * **`saved_at` je tu preto, že poradie bez hodnoty sa nedá použiť.** Do
     * 1. 9. 2026 si táto metóda `filemtime()` prečítala, zoradila ním a potom ho
     * z každého riadka `unset`-la — v odpovedi teda bolo PORADIE, ale nie ČAS.
     * Obrazovka preto nemohla napísať „pred 2 dňami" ani zoradiť inak než tak,
     * ako to poslal server, a klient si čas nemal odkiaľ vziať. Dátum je dáta.
     *
     * Radí sa naďalej podľa **celého čísla** `mtime`, nie podľa `saved_at`: ISO
     * s offsetom (`+02:00` vs `+01:00` cez hranicu DST) nie je lexikograficky
     * chronologický, a smernice napísané v lete a v zime sú v jednom adresári.
     * `mtime` sa z riadka vyhadzuje až po zoradení — je to interný kľúč, `saved_at`
     * je jeho verejný tvar.
     *
     * @return list<array{name: string, path: string, title: string, saved_at: string|null}>
     */
    private function saved(): array
    {
        $dir = (string) config('hades.directives_path', base_path('directives'));
        $out = [];

        foreach (glob(rtrim($dir, '/\\').'/*.md') ?: [] as $file) {
            $first = '';
            $fh = @fopen($file, 'r');
            if ($fh) {
                $line = fgets($fh);
                fclose($fh);
                $first = trim(ltrim((string) $line, "# \t"));
            }

            $mtime = @filemtime($file) ?: 0;

            $out[] = [
                'name' => pathinfo($file, PATHINFO_FILENAME),
                'path' => 'directives/'.basename($file),
                'title' => $first,
                // `null`, keď sa čas nedá prečítať — vymyslený „teraz" by riadok
                // poslal na začiatok zoznamu, čo je horšie než priznané prázdno.
                'saved_at' => $mtime > 0 ? \Illuminate\Support\Carbon::createFromTimestamp($mtime)->toIso8601String() : null,
                'mtime' => $mtime,
            ];
        }

        // najnovšie prvé podľa času úpravy
        usort($out, fn ($a, $b) => $b['mtime'] <=> $a['mtime']);
        foreach ($out as &$row) {
            unset($row['mtime']);
        }

        return $out;
    }
}
