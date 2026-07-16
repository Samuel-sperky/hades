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
 */
class TranscriptIngestService
{
    protected string $base;

    protected array $fileTools = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

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

        $sessionId = $rec['session_id'] ?: pathinfo($path, PATHINFO_FILENAME);
        $key = 'session:'.$sessionId;
        $existed = Node::where('external_key', $key)->exists();

        [$area, $department] = $this->classify($rec['project']);

        $title = $this->shortTitle($rec['prompts'][0]);
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

        $this->linkToProject($node, $rec['project']);

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

    protected function shortTitle(string $prompt): string
    {
        $first = trim(strtok($prompt, "\n"));
        if ($first === '') {
            $first = trim($prompt);
        }

        return Str::limit($first, 70);
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

    /** @return array{0: ?Area, 1: ?Department} */
    protected function classify(string $project): array
    {
        $area = Area::where('slug', 'vyvoj-kod')->first() ?? Area::orderBy('id')->first();
        if (! $area) {
            return [null, null];
        }

        $dept = Department::firstOrCreate(
            ['area_id' => $area->id, 'slug' => Str::slug($project)],
            ['name' => $project],
        );

        return [$area, $dept];
    }

    protected function linkToProject(Node $node, string $project): void
    {
        $needle = mb_strtolower(preg_replace('/[^a-z0-9]+/i', '', $project));
        if ($needle === '') {
            return;
        }

        $project = Node::where('type', 'project')
            ->whereNull('source')
            ->get()
            ->first(function (Node $p) use ($needle) {
                $hay = mb_strtolower(preg_replace('/[^a-z0-9]+/i', '', $p->label));

                return $hay !== '' && (str_contains($hay, $needle) || str_contains($needle, $hay));
            });

        if ($project && $project->id !== $node->id) {
            [$s, $t] = $node->id < $project->id ? [$node->id, $project->id] : [$project->id, $node->id];
            Edge::firstOrCreate(
                ['source_id' => $s, 'target_id' => $t],
                ['weight' => 1, 'last_activated_at' => now()],
            );
        }
    }
}
