<?php

namespace App\Services;

use App\Events\MindPulse;
use App\Models\Activation;
use App\Models\Area;
use App\Models\Department;
use App\Models\Edge;
use App\Models\Node;
use App\Models\Tombstone;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Throwable;

/**
 * Deterministický parser Claude Code transcriptov (JSONL) — bez modelu.
 * Z každej session vytvorí memory uzol so source=session a meta detailmi.
 *
 * v2: mapovanie projekt→oblasť, oddelenie "Záznamy — <projekt>", noise filter,
 * inteligentný titulok, auto project uzol a prepájanie na skill uzly.
 */
class TranscriptIngestService
{
    protected string $base;

    protected array $fileTools = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

    /** Krátke potvrdzovacie prompty, ktoré nenesú informáciu. */
    protected array $noiseWords = [
        'pokračuj', 'pokracuj', 'ok', 'oki', 'áno', 'ano', 'nie', 'dobre', 'super',
        'go', 'continue', 'yes', 'no', 'daj', 'ešte', 'este',
    ];

    public function __construct(
        protected SummaryService $summaries = new SummaryService(),
        protected SimilarityService $similarity = new SimilarityService(),
        protected MindService $mind = new MindService(),
    ) {
        $this->base = rtrim((string) config('hades.transcripts_path', '/transcripts'), '/');
    }

    /**
     * Spracuje všetky transcript súbory. $onlyNew spracuje len chýbajúce uzly
     * a súbory novšie než posledný zápis (meta.ingested_at). $forceRefresh
     * urobí plný refresh existujúcich uzlov (prepíše aj label/oblasť).
     */
    public function ingestAll(bool $onlyNew = true, bool $forceRefresh = false): array
    {
        $summary = ['processed' => 0, 'created' => 0, 'updated' => 0, 'skipped' => 0, 'files' => 0];

        // Náhrobky — zlúčené/archivované sessions sa už nikdy znovu nezapisujú
        $tombstoned = Tombstone::pluck('external_key')->flip();

        foreach ($this->transcriptFiles() as $path) {
            $summary['files']++;
            $key = 'session:'.pathinfo($path, PATHINFO_FILENAME);

            if ($tombstoned->has($key)) {
                $summary['skipped']++;

                continue;
            }

            if ($onlyNew && ! $forceRefresh) {
                $existing = Node::where('external_key', $key)->first(['id', 'meta']);
                if ($existing && ! $this->fileIsNewerThanIngest($path, $existing)) {
                    $summary['skipped']++;

                    continue;
                }
            }

            $result = $this->ingestFile($path, $forceRefresh);
            if ($result === null) {
                $summary['skipped']++;

                continue;
            }

            $summary['processed']++;
            $summary[$result]++;
        }

        return $summary;
    }

    /** Súbor sa spracuje znova, len keď je novší než posledný zápis do uzla. */
    protected function fileIsNewerThanIngest(string $path, Node $node): bool
    {
        $ingestedAt = $node->meta['ingested_at'] ?? null;
        if (! is_string($ingestedAt) || $ingestedAt === '') {
            return true; // starší záznam bez ingested_at → považuj za neaktuálny
        }

        try {
            $last = Carbon::parse($ingestedAt)->getTimestamp();
        } catch (Throwable) {
            return true;
        }

        $mtime = @filemtime($path);

        return $mtime === false || $mtime > $last;
    }

    public function transcriptFiles(): array
    {
        if (! is_dir($this->base)) {
            return [];
        }

        return glob($this->base.'/*/*.jsonl') ?: [];
    }

    /** @return 'created'|'updated'|null */
    public function ingestFile(string $path, bool $forceRefresh = false): ?string
    {
        if (! is_file($path)) {
            return null;
        }

        $rec = $this->parse($path);
        if ($rec === null || empty($rec['prompts'])) {
            return null; // prázdna / systémová session
        }

        // Noise filter — potvrdzovacie prompty nejdú do meta ani do titulku
        $allPrompts = $rec['prompts'];
        $prompts = array_values(array_filter($allPrompts, fn ($p) => ! $this->isNoisePrompt($p)));
        $noiseFiltered = count($allPrompts) - count($prompts);
        $rec['prompts'] = $prompts;

        $sessionId = $rec['session_id'] ?: pathinfo($path, PATHINFO_FILENAME);
        $key = 'session:'.$sessionId;

        // Náhrobok — zlúčená/archivovaná session sa nesmie vrátiť ako zombie
        if (Tombstone::where('external_key', $key)->exists()) {
            return null;
        }

        $existing = Node::where('external_key', $key)->first();

        $meta = [
            'session_id' => $sessionId,
            'project' => $rec['project'],
            'cwd' => $rec['cwd'],
            'git_branch' => $rec['git_branch'],
            'started_at' => $rec['started_at'],
            'ended_at' => $rec['ended_at'],
            'prompt_count' => count($rec['prompts']),
            'prompts' => array_slice($rec['prompts'], 0, 8),
            'noise_filtered' => $noiseFiltered,
            'files' => array_slice($rec['files'], 0, 20),
            'file_count' => count($rec['files']),
            'commits' => $rec['commits'],
            'tools' => $rec['tools'],
            'final' => $rec['final'],
            'ingested_at' => now()->toIso8601String(),
        ];

        // kľúče pohltené archívom/merge zostávajú v meta zachované
        if (! empty($existing?->meta['absorbed_keys'])) {
            $meta['absorbed_keys'] = $existing->meta['absorbed_keys'];
        }

        $lastActivatedAt = $rec['ended_at'] ? Carbon::parse($rec['ended_at']) : now();
        $created = false;

        if (! $existing) {
            [$area, $department] = $this->classify($rec['project']);

            $node = Node::create([
                'external_key' => $key,
                'type' => 'memory',
                'source' => 'session',
                'area_id' => $area?->id,
                'department_id' => $department?->id,
                'label' => $this->smartTitle($rec),
                'description' => $this->describe($rec),
                'meta' => $meta,
                'strength' => 1,
                'last_activated_at' => $lastActivatedAt,
            ]);
            $created = true;

            // umelo posunúť created_at na začiatok session (pre časovú os / denník)
            if ($rec['started_at']) {
                $node->forceFill(['created_at' => Carbon::parse($rec['started_at'])])->save();
            }
        } elseif ($forceRefresh) {
            // jednorazová oprava: plný refresh vrátane labelu/oblasti/oddelenia,
            // silu zachová (nikdy ju neresetuje späť na 1)
            [$area, $department] = $this->classify($rec['project']);

            $existing->fill([
                'type' => 'memory',
                'source' => 'session',
                'area_id' => $area?->id,
                'department_id' => $department?->id,
                'label' => $this->smartTitle($rec),
                'description' => $this->describe($rec),
                'meta' => $meta,
                'last_activated_at' => $lastActivatedAt,
            ])->save();
            $node = $existing;
        } else {
            // UPDATE: iba meta + last_activated_at — manuálne úpravy labelu,
            // popisu, oblasti a sily zostávajú nedotknuté
            $area = $this->resolveArea($rec['project']);

            $existing->fill([
                'meta' => $meta,
                'last_activated_at' => $lastActivatedAt,
            ])->save();
            $node = $existing;
        }

        $this->linkToProject($node, $rec['project'], $area, $created);

        // SUMMARY + .md — pri vytvorení, a aj pri jednorazovom --force-refresh
        // (aby staršie záznamy dostali extraktívne zhrnutie a summaries/ súbor)
        if ($created || $forceRefresh) {
            $summaryText = $this->summaries->forSession($meta);
            if (trim($summaryText) !== '') {
                $node->description = $summaryText;
            }

            // .md dokument session do summaries/sessions/<id>.md
            $safeId = preg_replace('/[^A-Za-z0-9._-]+/', '_', $sessionId);
            $relPath = 'summaries/sessions/'.$safeId.'.md';
            if ($this->writeMarkdown($relPath, $this->summaries->toMarkdown($node, $meta))) {
                $meta['summary_path'] = $relPath;
            }
            $node->forceFill(['meta' => $meta])->save();
        }

        if ($created) {
            // prepojenia a pulz len pri skutočnom vzniku (hrany rieši mind:rewire)
            $this->linkSkillMentions($node, $rec);
            $this->strengthenUsedSkills($rec, $key);
            $this->autoLinkSimilar($node);
            MindPulse::dispatch('node.created', ['node' => $node->toApi()]);
        }

        return $created ? 'created' : 'updated';
    }

    protected function parse(string $path): ?array
    {
        $fh = @fopen($path, 'r');
        if (! $fh) {
            return null;
        }

        $rec = [
            'session_id' => null, 'cwd' => null, 'project' => null, 'git_branch' => null,
            'started_at' => null, 'ended_at' => null,
            'prompts' => [], 'files' => [], 'commits' => [], 'tools' => [], 'final' => null,
        ];
        $toolCounts = [];

        while (($line = fgets($fh)) !== false) {
            $line = trim($line);
            if ($line === '') {
                continue;
            }
            $o = json_decode($line, true);
            if (! is_array($o)) {
                continue;
            }

            if (! empty($o['sessionId']) && ! $rec['session_id']) {
                $rec['session_id'] = $o['sessionId'];
            }
            if (! empty($o['cwd']) && ! $rec['cwd']) {
                $rec['cwd'] = $o['cwd'];
                $rec['project'] = $this->projectName($o['cwd']);
            }
            if (! empty($o['gitBranch']) && ! $rec['git_branch']) {
                $rec['git_branch'] = $o['gitBranch'];
            }
            if (! empty($o['timestamp'])) {
                $ts = $o['timestamp'];
                if (! $rec['started_at'] || $ts < $rec['started_at']) {
                    $rec['started_at'] = $ts;
                }
                if (! $rec['ended_at'] || $ts > $rec['ended_at']) {
                    $rec['ended_at'] = $ts;
                }
            }

            // Používateľské prompty
            if (($o['type'] ?? null) === 'queue-operation'
                && ($o['operation'] ?? null) === 'enqueue'
                && is_string($o['content'] ?? null)) {
                $p = $this->cleanPrompt($o['content']);
                if ($p !== '') {
                    $rec['prompts'][] = $p;
                }
            }

            // Asistent: tool_use bloky + finálny text
            $msg = $o['message'] ?? null;
            if (is_array($msg) && ($msg['role'] ?? null) === 'assistant' && is_array($msg['content'] ?? null)) {
                foreach ($msg['content'] as $block) {
                    if (! is_array($block)) {
                        continue;
                    }
                    $bt = $block['type'] ?? null;
                    if ($bt === 'tool_use') {
                        $name = $block['name'] ?? 'tool';
                        $toolCounts[$name] = ($toolCounts[$name] ?? 0) + 1;
                        $input = $block['input'] ?? [];

                        if (in_array($name, $this->fileTools, true)) {
                            $fp = $input['file_path'] ?? $input['path'] ?? ($input['notebook_path'] ?? null);
                            if ($fp) {
                                $rec['files'][$fp] = true;
                            }
                        }
                        if ($name === 'Bash' && is_string($input['command'] ?? null)) {
                            $this->extractCommits($input['command'], $rec['commits']);
                        }
                        if (($name === 'PowerShell') && is_string($input['command'] ?? null)) {
                            $this->extractCommits($input['command'], $rec['commits']);
                        }
                    } elseif ($bt === 'text' && is_string($block['text'] ?? null) && trim($block['text']) !== '') {
                        $rec['final'] = $block['text'];
                    }
                }
            }
        }
        fclose($fh);

        $rec['files'] = $this->normalizeFilePaths(array_keys($rec['files']), $rec['cwd']);
        arsort($toolCounts);
        $rec['tools'] = $toolCounts;
        if (is_string($rec['final'])) {
            $rec['final'] = Str::limit(trim(preg_replace('/\s+/', ' ', $rec['final'])), 400);
        }
        $rec['commits'] = array_values(array_unique($rec['commits']));

        return $rec;
    }

    /**
     * Cesty súborov relatívne k cwd session (ak sa dá), inak absolútne.
     * Zjednotí lomky a odstráni duplicity.
     *
     * @param  array<int, string>  $paths
     * @return array<int, string>
     */
    protected function normalizeFilePaths(array $paths, ?string $cwd): array
    {
        $cwd = $cwd ? rtrim(str_replace('\\', '/', $cwd), '/') : null;
        $cwdLower = $cwd ? mb_strtolower($cwd) : null;

        $out = [];
        foreach ($paths as $fp) {
            $norm = str_replace('\\', '/', $fp);
            if ($cwdLower && str_starts_with(mb_strtolower($norm), $cwdLower.'/')) {
                $norm = ltrim(substr($norm, strlen($cwd)), '/');
            }
            if ($norm !== '') {
                $out[$norm] = true;
            }
        }

        return array_keys($out);
    }

    /** Krátke potvrdzovacie prompty typu "ok", "pokračuj" nenesú informáciu. */
    public function isNoisePrompt(string $prompt): bool
    {
        $trimmed = trim($prompt);
        if (mb_strlen($trimmed) < 15) {
            return true;
        }

        // systémový obsah vložený harnessom nie je používateľský prompt
        if (str_starts_with($trimmed, '<') || str_starts_with($trimmed, '[SYSTEM')
            || str_starts_with($trimmed, '[Image') || str_starts_with($trimmed, 'Caveat:')) {
            return true;
        }

        // interpunkciu preč, porovnaj s whitelist-om šumu
        $bare = mb_strtolower(trim(preg_replace('/[\p{P}\p{S}]+/u', '', $trimmed)));

        return in_array($bare, $this->noiseWords, true);
    }

    protected function extractCommits(string $command, array &$commits): void
    {
        if (! preg_match('/git\s+(-c\s+\S+\s+)*commit/i', $command)) {
            return;
        }
        // -m "..." alebo -m @'...' heredoc — vytiahni prvý riadok správy
        if (preg_match('/-m\s+"([^"]+)"/', $command, $m)) {
            $commits[] = trim(strtok($m[1], "\n"));
        } elseif (preg_match("/-m\s+@?'([^']+)'/s", $command, $m)) {
            $commits[] = trim(strtok($m[1], "\n"));
        } elseif (preg_match('/@\'\s*\n(.+?)\n/s', $command, $m)) {
            $commits[] = trim($m[1]);
        } else {
            $commits[] = 'commit';
        }
    }

    protected function cleanPrompt(string $content): string
    {
        // odstráň @"cesta" file referencie a nadbytočné medzery
        $content = preg_replace('/@"[^"]*"/', '', $content);
        $content = preg_replace('/@\S+\.\w+/', '', $content);

        return trim(preg_replace('/[ \t]+/', ' ', $content));
    }

    /**
     * Titulok v2: prejde všetky zmysluplné prompty, odstráni úvodné
     * slash-commandy a URL a použije prvú vetu s aspoň 15 znakmi.
     * Titulok nikdy nezačína na "http", "www." ani "/".
     * Fallback: "<projekt> — práca <dátum>".
     */
    protected function smartTitle(array $rec): string
    {
        foreach ($rec['prompts'] as $prompt) {
            if (! is_string($prompt) || trim($prompt) === '') {
                continue;
            }

            $clean = $this->cleanPrompt($prompt);

            // opakovane odstráň úvodný slash-command token a úvodné URL
            do {
                $before = $clean;
                $clean = preg_replace('/^\/[\w:-]+\s*/u', '', $clean);
                $clean = preg_replace('/^(https?:\/\/\S+|www\.\S+)\s*/iu', '', $clean);
                $clean = ltrim($clean);
            } while ($clean !== $before);

            // prvá veta — rozdeľ na . ! ? alebo nový riadok
            $parts = preg_split('/(?<=[.!?])\s+|\r?\n/u', trim($clean), 2);
            $sentence = trim(preg_replace('/\s+/u', ' ', $parts[0] ?? ''));

            if (mb_strlen($sentence) < 15 || preg_match('/^(https?:|www\.|\/)/iu', $sentence)) {
                continue;
            }

            if (mb_strlen($sentence) <= 60) {
                return $sentence;
            }

            // skráť na 60 znakov, ale nikdy uprostred slova
            $cut = mb_substr($sentence, 0, 60);
            $lastSpace = mb_strrpos($cut, ' ');
            if ($lastSpace !== false && $lastSpace > 0) {
                $cut = mb_substr($cut, 0, $lastSpace);
            }

            return rtrim($cut, " \t.,;:—-");
        }

        $date = $rec['started_at'] ? Carbon::parse($rec['started_at'])->format('j.n.Y') : now()->format('j.n.Y');

        return ($rec['project'] ?? 'projekt').' — práca '.$date;
    }

    protected function describe(array $rec): string
    {
        $date = $rec['started_at'] ? Carbon::parse($rec['started_at'])->format('j.n.Y') : '';
        $parts = [];
        $parts[] = $date.' · '.($rec['project'] ?? 'projekt');
        $parts[] = count($rec['prompts']).' promptov';
        if (count($rec['files'])) {
            $parts[] = count($rec['files']).' súborov';
        }
        if (count($rec['commits'])) {
            $parts[] = count($rec['commits']).' commitov';
        }
        $line = implode(' · ', $parts);

        if ($rec['final']) {
            $line .= "\n\n".$rec['final'];
        }

        return $line;
    }

    protected function projectName(string $cwd): string
    {
        $cwd = str_replace('\\', '/', $cwd);

        return basename(rtrim($cwd, '/')) ?: 'projekt';
    }

    /**
     * Projekt → oblasť podľa config('hades.project_area_map'); case-insensitive,
     * skúša aj čiastočnú zhodu (contains oboma smermi). Fallback z configu.
     */
    public function resolveArea(?string $project): ?Area
    {
        $map = (array) config('hades.project_area_map', []);
        $needle = mb_strtolower(trim((string) $project));

        $slug = null;
        if ($needle !== '') {
            // presná zhoda (case-insensitive)
            foreach ($map as $name => $areaSlug) {
                if (mb_strtolower($name) === $needle) {
                    $slug = $areaSlug;
                    break;
                }
            }
            // čiastočná zhoda — názov projektu obsahuje kľúč alebo naopak
            if ($slug === null) {
                foreach ($map as $name => $areaSlug) {
                    $key = mb_strtolower($name);
                    if (str_contains($needle, $key) || str_contains($key, $needle)) {
                        $slug = $areaSlug;
                        break;
                    }
                }
            }
        }

        $slug ??= (string) config('hades.project_area_fallback', 'vyvoj-kod');

        return Area::where('slug', $slug)->first() ?? Area::orderBy('id')->first();
    }

    /** @return array{0: ?Area, 1: ?Department} */
    public function classify(?string $project): array
    {
        $area = $this->resolveArea($project);
        if (! $area) {
            return [null, null];
        }

        $project = trim((string) $project) ?: 'projekt';
        $dept = Department::firstOrCreate(
            ['area_id' => $area->id, 'slug' => 'zaznamy-'.Str::slug($project)],
            ['name' => 'Záznamy — '.$project],
        );

        return [$area, $dept];
    }

    /**
     * Auto project uzol: firstOrCreate 'project:<slug>' a prepoj záznam naň.
     * Váha hrany rastie len keď bol session uzol v tomto behu vytvorený —
     * opakovaný ingest nie je nová aktivita.
     */
    protected function linkToProject(Node $node, ?string $project, ?Area $area, bool $created): void
    {
        $project = trim((string) $project);
        if ($project === '') {
            return;
        }

        $projectNode = Node::firstOrCreate(
            ['external_key' => 'project:'.Str::slug($project)],
            [
                'type' => 'project',
                'source' => null,
                'label' => $project,
                'area_id' => $area?->id,
                'department_id' => null,
                'strength' => 2,
                'last_activated_at' => now(),
            ],
        );

        if ($projectNode->id === $node->id) {
            return;
        }

        [$s, $t] = $node->id < $projectNode->id ? [$node->id, $projectNode->id] : [$projectNode->id, $node->id];
        $edge = Edge::firstOrCreate(
            ['source_id' => $s, 'target_id' => $t],
            // príslušnosť záznamu k projektu je automatická co-aktivačná synapsia
            ['weight' => 1, 'kind' => 'co_activation', 'auto' => true, 'last_activated_at' => now()],
        );

        if ($created && ! $edge->wasRecentlyCreated) {
            $edge->increment('weight');
            $edge->forceFill(['last_activated_at' => now()])->save();
        }
    }

    /**
     * Prepojenie na skill uzly, ktorých label sa spomína v promptoch/finálnom texte.
     * Max 5 prepojení na záznam.
     */
    protected function linkSkillMentions(Node $node, array $rec): void
    {
        $text = mb_strtolower(implode(' ', $rec['prompts']).' '.(string) $rec['final']);
        if (trim($text) === '') {
            return;
        }

        $linked = 0;
        $skills = Node::where('type', 'skill')->get(['id', 'label']);

        foreach ($skills as $skill) {
            if ($linked >= 5) {
                break;
            }
            if (mb_strlen($skill->label) < 4) {
                continue;
            }

            $needles = [mb_strtolower($skill->label)];
            // "SEO analysis (Ahrefs)" → skús aj "seo analysis"
            $bare = trim(mb_strtolower(preg_replace('/\s*\([^)]*\)\s*$/u', '', $skill->label)));
            if ($bare !== '' && $bare !== $needles[0] && mb_strlen($bare) >= 4) {
                $needles[] = $bare;
            }

            $hit = false;
            foreach ($needles as $needle) {
                // celé slová — "git" sa nesmie trafiť v "digital"
                $pattern = '/(?<![\p{L}\p{N}])'.preg_quote($needle, '/').'(?![\p{L}\p{N}])/ui';
                if (preg_match($pattern, $text)) {
                    $hit = true;
                    break;
                }
            }
            if (! $hit || $skill->id === $node->id) {
                continue;
            }

            // zmienka skillu v zázname → automatická skill_mention synapsia
            $this->mind->connect($node, $skill, 'skill_mention', true);
            $linked++;
        }
    }

    /**
     * E5: skutočné použitie skillu — skill node sa spomína ako tool v meta.tools
     * alebo ako celé slovo v promptoch → posilni ho (strength + last_activated_at),
     * aby reálna práca so skillom bola v sieti vidieť. Beží len pri vytvorení záznamu.
     */
    protected function strengthenUsedSkills(array $rec, ?string $sessionKey): void
    {
        $tools = array_map('mb_strtolower', array_keys((array) ($rec['tools'] ?? [])));
        $text = mb_strtolower(implode(' ', $rec['prompts']).' '.(string) $rec['final']);
        if ($tools === [] && trim($text) === '') {
            return;
        }

        $strengthened = 0;
        foreach (Node::where('type', 'skill')->get(['id', 'label', 'strength', 'last_activated_at']) as $skill) {
            if ($strengthened >= 5) {
                break;
            }

            $label = mb_strtolower($skill->label);
            $bare = trim(mb_strtolower(preg_replace('/\s*\([^)]*\)\s*$/u', '', $skill->label)));
            $needles = array_values(array_unique(array_filter([$label, $bare], fn ($n) => mb_strlen((string) $n) >= 4)));

            // priama zhoda s názvom použitého toolu (Skill/playbook)
            $used = in_array($label, $tools, true) || ($bare !== '' && in_array($bare, $tools, true));

            // alebo zmienka ako celé slovo v promptoch/finále
            if (! $used) {
                foreach ($needles as $needle) {
                    $pattern = '/(?<![\p{L}\p{N}])'.preg_quote($needle, '/').'(?![\p{L}\p{N}])/ui';
                    if (preg_match($pattern, $text)) {
                        $used = true;
                        break;
                    }
                }
            }

            if (! $used) {
                continue;
            }

            $skill->increment('strength');
            $skill->forceFill(['last_activated_at' => now()])->save();
            Activation::record($skill, 'skill-used', $sessionKey);
            MindPulse::dispatch('node.activated', [
                'node_id' => $skill->id,
                'strength' => (float) $skill->strength,
            ]);
            $strengthened++;
        }
    }

    /**
     * A2: po vytvorení uzla ho automaticky prepoj na top-3 najpodobnejšie uzly
     * (TF-IDF kosínus, prah 0.18). Vylúč core uzly a už prepojené uzly.
     * A4: dva session záznamy RÔZNYCH projektov sa priamo neprepájajú
     * (spájajú sa nepriamo cez zdieľané skill uzly). Similarity hrana má váhu 0.5.
     */
    protected function autoLinkSimilar(Node $node): void
    {
        // uzly už prepojené s týmto záznamom (projekt + skilly) sa vylúčia
        $linkedIds = Edge::query()
            ->where('source_id', $node->id)
            ->orWhere('target_id', $node->id)
            ->get(['source_id', 'target_id'])
            ->flatMap(fn (Edge $e) => [$e->source_id, $e->target_id])
            ->reject(fn ($id) => $id === $node->id)
            ->unique()
            ->flip();

        $isSession = $node->type === 'memory' && $node->source === 'session';
        $ownProject = (string) ($node->meta['project'] ?? '');

        $filter = function (Node $cand) use ($node, $linkedIds, $isSession, $ownProject) {
            if ($cand->id === $node->id) {
                return false;
            }
            if ($cand->type === 'core') {
                return false;
            }
            if ($linkedIds->has($cand->id)) {
                return false;
            }
            // A4: dva session záznamy rôznych projektov sa priamo nespájajú
            if ($isSession && $cand->type === 'memory' && $cand->source === 'session') {
                if ((string) ($cand->meta['project'] ?? '') !== $ownProject) {
                    return false;
                }
            }

            return true;
        };

        // korpus sa nahreje čerstvo — musí obsahovať aj práve vytvorený uzol
        $this->similarity->warmCorpus(Node::query()->get());
        $top = $this->similarity->topSimilar($node, 3, 0.18, $filter);

        foreach ($top as $hit) {
            $other = Node::find($hit['node_id']);
            if (! $other) {
                continue;
            }
            // odvodená synapsia s polovičnou počiatočnou váhou
            $this->mind->connect($node, $other, 'similarity', true, 0.5);
        }
    }

    /**
     * Zapíše markdown do <base_path>/<relPath>, vytvorí adresár ak treba.
     * Repo je v kontajneri writable. Vráti true pri úspechu.
     */
    protected function writeMarkdown(string $relPath, string $contents): bool
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
