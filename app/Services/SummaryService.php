<?php

namespace App\Services;

use App\Models\Node;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * Extraktívne, deterministické zhrnutia sessions a projektov — bez modelu.
 * Stavia len z už rozparsovaného meta (TranscriptIngestService).
 */
class SummaryService
{
    /** Kľúčové technológie/skilly, ktoré vieme rozpoznať skenom textu. */
    protected array $techTerms = [
        'docker', 'compose', 'mariadb', 'mysql', 'laravel', 'php', 'redis',
        'api', 'mcp', 'reverb', 'websocket', 'websockets', 'seo', 'ads',
        'figma', 'vite', 'tailwind', 'vue', 'react', 'javascript', 'typescript',
        'python', 'git', 'github', 'nginx', 'haproxy', 's3', 'minio', 'stripe',
        'oauth', 'jwt', 'cron', 'queue', 'migration', 'eloquent', 'blade',
        'canvas', 'webgl', 'd3', 'artisan', 'tinker', 'pest', 'phpstan',
        'ahrefs', 'canva', 'openvpn', 'graphql', 'sqlite', 'nodejs', 'npm',
    ];

    /** Návestia rozhodnutí (SK + EN). */
    protected array $decisionCues = [
        'rozhod', 'zvol', 'pouzij', 'použij', 'budeme', 'we decided',
        "let's use", 'chcem aby', 'chcem, aby',
    ];

    /**
     * Štruktúrované slovenské zhrnutie session (~4 riadky, markdown-ish).
     * Zahrnie len sekcie, ktoré majú dáta.
     */
    public function forSession(array $meta): string
    {
        $prompts = array_values(array_filter((array) ($meta['prompts'] ?? []), 'is_string'));
        $final = (string) ($meta['final'] ?? '');
        $commits = array_values(array_filter((array) ($meta['commits'] ?? []), 'is_string'));
        $files = array_values(array_filter((array) ($meta['files'] ?? []), 'is_string'));

        $lines = [];

        // Čo — prvý zmysluplný prompt (bez úvodného /príkazu a URL)
        $what = '';
        foreach ($prompts as $p) {
            $cleaned = $this->stripLeadNoise($p);
            if (mb_strlen($cleaned) >= 12) {
                $what = $cleaned;
                break;
            }
        }
        if ($what !== '') {
            $lines[] = '**Čo:** '.$this->clip($what, 120);
        }

        // Výsledok — commity, inak posledný finálny blok
        if ($commits !== []) {
            $lines[] = '**Výsledok:** '.$this->clip(implode('; ', $commits), 120);
        } elseif (trim($final) !== '') {
            $lines[] = '**Výsledok:** '.$this->clip($final, 120);
        }

        // Súbory — max 6 basenamov
        if ($files !== []) {
            $names = array_slice(array_map(fn ($f) => basename(str_replace('\\', '/', $f)), $files), 0, 6);
            $lines[] = '**Súbory:** '.implode(', ', $names);
        }

        // Technológie — sken promptov + finálneho textu
        $tech = $this->detectTech(implode(' ', $prompts).' '.$final);
        if ($tech !== []) {
            $lines[] = '**Technológie:** '.implode(', ', $tech);
        }

        // Rozhodnutia — vety s návestím rozhodnutia
        $decisions = $this->extractDecisions($prompts, $final);
        if ($decisions !== []) {
            $lines[] = '**Rozhodnutia:** '.implode(' ', array_map(fn ($d) => '• '.$d, $decisions));
        }

        return implode(' ', $lines);
    }

    /** Odstráni úvodný /slash-command a vedúce URL, aby zhrnutie nezačínalo šumom. */
    protected function stripLeadNoise(string $text): string
    {
        $t = trim($text);
        // opakovane zlúp vedúci /príkaz alebo URL
        do {
            $before = $t;
            $t = preg_replace('~^/[\w:.-]+\s*~u', '', $t);
            $t = preg_replace('~^(https?://\S+|www\.\S+)\s*~iu', '', $t);
            $t = ltrim($t);
        } while ($t !== $before);

        return $t;
    }

    /**
     * Plný .md dokument session pre zápis do summaries/.
     */
    public function toMarkdown(Node $node, array $meta): string
    {
        $project = (string) ($meta['project'] ?? '');
        $sessionId = (string) ($meta['session_id'] ?? '');
        $date = $this->fmtDate($meta['started_at'] ?? $meta['ended_at'] ?? null);

        $out = [];
        $out[] = '---';
        $out[] = 'title: '.$this->yamlValue($node->label);
        $out[] = 'project: '.$this->yamlValue($project);
        $out[] = 'date: '.$date;
        $out[] = 'session_id: '.$this->yamlValue($sessionId);
        $out[] = 'source: '.$this->yamlValue((string) ($node->source ?? 'session'));
        $out[] = '---';
        $out[] = '';
        $out[] = '# '.$node->label;
        $out[] = '';
        $out[] = $this->forSession($meta);

        $prompts = array_values(array_filter((array) ($meta['prompts'] ?? []), 'is_string'));
        if ($prompts !== []) {
            $out[] = '';
            $out[] = '## Prompty';
            foreach (array_slice($prompts, 0, 8) as $p) {
                $out[] = '- '.$this->clip($p, 200);
            }
        }

        $files = array_values(array_filter((array) ($meta['files'] ?? []), 'is_string'));
        if ($files !== []) {
            $out[] = '';
            $out[] = '## Súbory';
            foreach (array_slice($files, 0, 20) as $f) {
                $out[] = '- '.$f;
            }
        }

        $commits = array_values(array_filter((array) ($meta['commits'] ?? []), 'is_string'));
        if ($commits !== []) {
            $out[] = '';
            $out[] = '## Commity';
            foreach ($commits as $c) {
                $out[] = '- '.$c;
            }
        }

        $final = trim((string) ($meta['final'] ?? ''));
        if ($final !== '') {
            $out[] = '';
            $out[] = '## Záver';
            $out[] = $final;
        }

        return implode("\n", $out)."\n";
    }

    /**
     * Živý roll-up projektu: prehľad, počet, rozsah dátumov, zoznam posledných
     * 20 sessions a agregované technológie.
     */
    public function forProjectRollup(string $project, Collection $sessionNodes): string
    {
        $sorted = $sessionNodes->sortByDesc(
            fn (Node $n) => $n->last_activated_at?->getTimestamp() ?? 0
        )->values();

        $dates = $sessionNodes
            ->map(fn (Node $n) => $n->meta['started_at'] ?? $n->meta['ended_at'] ?? null)
            ->filter()
            ->map(fn ($d) => Carbon::parse($d))
            ->sort()
            ->values();

        $range = '';
        if ($dates->isNotEmpty()) {
            $from = $dates->first()->format('j.n.Y');
            $to = $dates->last()->format('j.n.Y');
            $range = $from === $to ? $from : $from.' – '.$to;
        }

        // agregované technológie naprieč session-mi
        $techBag = '';
        foreach ($sessionNodes as $n) {
            $meta = is_array($n->meta) ? $n->meta : [];
            $techBag .= ' '.implode(' ', array_filter((array) ($meta['prompts'] ?? []), 'is_string'));
            $techBag .= ' '.(string) ($meta['final'] ?? '');
            if (! empty($meta['tools']) && is_array($meta['tools'])) {
                $techBag .= ' '.implode(' ', array_keys($meta['tools']));
            }
        }
        $tech = $this->detectTech($techBag);

        $out = [];
        $out[] = '---';
        $out[] = 'title: '.$this->yamlValue($project);
        $out[] = 'type: project-rollup';
        $out[] = 'sessions: '.$sessionNodes->count();
        $out[] = 'range: '.$range;
        $out[] = 'updated: '.now()->toIso8601String();
        $out[] = '---';
        $out[] = '';
        $out[] = '# '.$project;
        $out[] = '';
        $out[] = '**Sessions:** '.$sessionNodes->count().($range !== '' ? '  ·  **Obdobie:** '.$range : '');
        if ($tech !== []) {
            $out[] = '';
            $out[] = '**Technológie:** '.implode(', ', $tech);
        }
        $out[] = '';
        $out[] = '## Záznamy';
        foreach ($sorted->take(20) as $n) {
            $d = $this->fmtDate($n->meta['started_at'] ?? $n->meta['ended_at'] ?? null);
            $out[] = '- '.($d !== '' ? $d.' — ' : '').$n->label;
        }

        return implode("\n", $out)."\n";
    }

    /**
     * Vytiahne vety s návestím rozhodnutia z promptov + finálneho textu.
     * Max 3, deduplikované, orezané.
     *
     * @param  array<int, string>  $prompts
     * @return array<int, string>
     */
    protected function extractDecisions(array $prompts, string $final): array
    {
        $text = implode("\n", $prompts)."\n".$final;
        $sentences = preg_split('/(?<=[.!?])\s+|\r?\n/u', $text, -1, PREG_SPLIT_NO_EMPTY) ?: [];

        $out = [];
        $seen = [];
        foreach ($sentences as $sentence) {
            $sentence = trim(preg_replace('/\s+/u', ' ', $sentence));
            if ($sentence === '' || mb_strlen($sentence) < 10) {
                continue;
            }

            $low = mb_strtolower($sentence);
            $hit = false;
            foreach ($this->decisionCues as $cue) {
                if (str_contains($low, $cue)) {
                    $hit = true;
                    break;
                }
            }
            if (! $hit) {
                continue;
            }

            $clipped = $this->clip($sentence, 140);
            $dedupKey = mb_strtolower($clipped);
            if (isset($seen[$dedupKey])) {
                continue;
            }
            $seen[$dedupKey] = true;
            $out[] = $clipped;

            if (count($out) >= 3) {
                break;
            }
        }

        return $out;
    }

    /**
     * Rozpozná technologické termy v texte (celé slová, case-insensitive),
     * zachová poradie z $techTerms a deduplikuje.
     *
     * @return array<int, string>
     */
    protected function detectTech(string $text): array
    {
        $low = strtr(mb_strtolower($text), ['.' => ' ', '/' => ' ']);
        $found = [];
        foreach ($this->techTerms as $term) {
            $pattern = '/(?<![a-z0-9])'.preg_quote($term, '/').'(?![a-z0-9])/u';
            if (preg_match($pattern, $low)) {
                $found[$term] = true;
            }
        }

        return array_keys($found);
    }

    /** Oreže reťazec na max znakov, na hranici slova, s "…". */
    protected function clip(string $text, int $max): string
    {
        $text = trim(preg_replace('/\s+/u', ' ', $text));

        return Str::limit($text, $max, '…');
    }

    /** Bezpečná YAML hodnota v úvodzovkách. */
    protected function yamlValue(string $value): string
    {
        return '"'.str_replace('"', '\"', trim($value)).'"';
    }

    /** ISO/parsovateľný dátum → j.n.Y, inak ''. */
    protected function fmtDate(mixed $raw): string
    {
        if (! is_string($raw) || trim($raw) === '') {
            return '';
        }

        try {
            return Carbon::parse($raw)->format('j.n.Y');
        } catch (\Throwable) {
            return '';
        }
    }
}
