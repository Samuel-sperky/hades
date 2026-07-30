<?php

namespace App\Services\Ingest;

use App\Services\Brain\SecretScanner;
use Illuminate\Support\Str;

/**
 * PARSER — jediná vrstva, ktorá sa pozerá na súbor. Prečíta Claude Code
 * transcript (JSONL) a vráti surový záznam session ako pole. Žiadny model,
 * žiadny prístup do DB, žiadny zápis.
 *
 * Vyčlenené z {@see \App\Services\TranscriptIngestService} (W2/P3) bez zmeny
 * chovania — ingest beží každých 10 minút na živých dátach, takže regexy,
 * poradie krokov aj hranice orezania sú prenesené verbatim.
 *
 * Tvar záznamu (kľúče sú kontrakt pre klasifikátor, titulkovač a writer):
 *   session_id, cwd, project, git_branch, started_at, ended_at,
 *   prompts[], files[], commits[], tools{name: count}, final
 */
class TranscriptParser
{
    /** Nástroje, ktorých vstup nesie cestu k súboru. */
    protected array $fileTools = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

    /** Krátke potvrdzovacie prompty, ktoré nenesú informáciu. */
    protected array $noiseWords = [
        'pokračuj', 'pokracuj', 'ok', 'oki', 'áno', 'ano', 'nie', 'dobre', 'super',
        'go', 'continue', 'yes', 'no', 'daj', 'ešte', 'este',
    ];

    public function __construct(
        protected SecretScanner $secrets = new SecretScanner(),
    ) {}

    /**
     * Rozparsuje jeden JSONL transcript. Vracia null, keď sa súbor nedá otvoriť.
     *
     * @return array<string, mixed>|null
     */
    public function parse(string $path): ?array
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
                        $rec['final'] = $this->secrets->redact($block['text']);
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
     * Odfiltruje potvrdzovacie prompty. Vracia prompty bez šumu a počet
     * odfiltrovaných (ide do meta.noise_filtered).
     *
     * @param  array<int, string>  $prompts
     * @return array{0: array<int, string>, 1: int}
     */
    public function filterNoise(array $prompts): array
    {
        $kept = array_values(array_filter($prompts, fn ($p) => ! $this->isNoisePrompt($p)));

        return [$kept, count($prompts) - count($kept)];
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

    /**
     * Očistí prompt: preč @"cesta" referencie, redakcia tajomstiev, zrazené medzery.
     *
     * Redakcia tajomstiev je PRED zápisom do pamäte. Prompty bežne obsahujú vloženú
     * dokumentáciu s API kľúčmi a tento ingest z nich robí label, popis, meta aj
     * .md súbor. SecretScanner bol dovtedy zapojený len v MCP a BrainWriter, takže
     * transcript bola jediná cesta, ktorou sa kľúč mohol dostať do siete.
     * Nezamietame celý prompt (to by bola tichá strata pamäte) — vystrihneme len
     * zhodu a zvyšok spomienky zapíšeme.
     */
    public function cleanPrompt(string $content): string
    {
        // odstráň @"cesta" file referencie a nadbytočné medzery
        $content = preg_replace('/@"[^"]*"/', '', $content);
        $content = preg_replace('/@\S+\.\w+/', '', $content);

        $content = $this->secrets->redact($content);

        return trim(preg_replace('/[ \t]+/', ' ', $content));
    }

    /** Názov projektu = posledný segment cwd. */
    public function projectName(string $cwd): string
    {
        $cwd = str_replace('\\', '/', $cwd);

        return basename(rtrim($cwd, '/')) ?: 'projekt';
    }

    /** Z `git commit -m "…"` vytiahne prvý riadok správy. */
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
}
