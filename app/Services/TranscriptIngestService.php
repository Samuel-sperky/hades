<?php

namespace App\Services;

use App\Events\MindPulse;
use App\Models\Area;
use App\Models\Department;
use App\Models\Edge;
use App\Models\Node;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

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

    public function __construct()
    {
        $this->base = rtrim((string) config('hades.transcripts_path', '/transcripts'), '/');
    }

    /** Spracuje všetky transcript súbory; $onlyNew preskočí už zapísané sessions. */
    public function ingestAll(bool $onlyNew = true): array
    {
        $summary = ['processed' => 0, 'created' => 0, 'updated' => 0, 'skipped' => 0, 'files' => 0];

        foreach ($this->transcriptFiles() as $path) {
            $summary['files']++;
            $key = 'session:'.pathinfo($path, PATHINFO_FILENAME);

            if ($onlyNew && Node::where('external_key', $key)->exists()) {
                $summary['skipped']++;

                continue;
            }

            $result = $this->ingestFile($path);
            if ($result === null) {
                $summary['skipped']++;

                continue;
            }

            $summary['processed']++;
            $summary[$result]++;
        }

        return $summary;
    }

    public function transcriptFiles(): array
    {
        if (! is_dir($this->base)) {
            return [];
        }

        return glob($this->base.'/*/*.jsonl') ?: [];
    }

    /** @return 'created'|'updated'|null */
    public function ingestFile(string $path): ?string
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
        $existed = Node::where('external_key', $key)->exists();

        [$area, $department] = $this->classify($rec['project']);

        $title = $this->smartTitle($rec);
        $desc = $this->describe($rec);

        $node = Node::updateOrCreate(
            ['external_key' => $key],
            [
                'type' => 'memory',
                'source' => 'session',
                'area_id' => $area?->id,
                'department_id' => $department?->id,
                'label' => $title,
                'description' => $desc,
                'meta' => [
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
                ],
                'strength' => 1,
                'last_activated_at' => $rec['ended_at'] ? Carbon::parse($rec['ended_at']) : now(),
            ],
        );

        // umelo posunúť created_at na začiatok session (pre časovú os / denník)
        if (! $existed && $rec['started_at']) {
            $node->forceFill(['created_at' => Carbon::parse($rec['started_at'])])->save();
        }

        $this->linkToProject($node, $rec['project'], $area);
        $this->linkSkillMentions($node, $rec);

        if (! $existed) {
            MindPulse::dispatch('node.created', ['node' => $node->toApi()]);
        }

        return $existed ? 'updated' : 'created';
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
                                $rec['files'][basename($fp)] = true;
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

        $rec['files'] = array_keys($rec['files']);
        arsort($toolCounts);
        $rec['tools'] = $toolCounts;
        if (is_string($rec['final'])) {
            $rec['final'] = Str::limit(trim(preg_replace('/\s+/', ' ', $rec['final'])), 400);
        }
        $rec['commits'] = array_values(array_unique($rec['commits']));

        return $rec;
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
     * Titulok z prvej zmysluplnej prompty: prvá veta, max 60 znakov
     * bez rozseknutia slova. Fallback: "<projekt> — práca <dátum>".
     */
    protected function smartTitle(array $rec): string
    {
        $prompt = $rec['prompts'][0] ?? null;

        if (is_string($prompt) && trim($prompt) !== '') {
            // prvá veta — rozdeľ na . ! ? alebo nový riadok
            $parts = preg_split('/(?<=[.!?])\s+|\r?\n/u', trim($prompt), 2);
            $sentence = trim($parts[0] ?? '');
            $sentence = $this->cleanPrompt($sentence);
            $sentence = trim(preg_replace('/\s+/u', ' ', $sentence));

            if ($sentence !== '') {
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
     * Pri opakovaní sa hrana posilňuje.
     */
    protected function linkToProject(Node $node, ?string $project, ?Area $area): void
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
            ['weight' => 1, 'last_activated_at' => now()],
        );

        if (! $edge->wasRecentlyCreated) {
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
                if (str_contains($text, $needle)) {
                    $hit = true;
                    break;
                }
            }
            if (! $hit || $skill->id === $node->id) {
                continue;
            }

            [$s, $t] = $node->id < $skill->id ? [$node->id, $skill->id] : [$skill->id, $node->id];
            Edge::firstOrCreate(
                ['source_id' => $s, 'target_id' => $t],
                ['weight' => 1, 'last_activated_at' => now()],
            );
            $linked++;
        }
    }
}
