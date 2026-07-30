<?php

namespace App\Services\Maintenance\DryRun;

use Illuminate\Support\Facades\Storage;

/**
 * Zápis dry-run reportu do storage/app/dry-run/ — JSON (pre W3 kalibráciu) aj
 * Markdown (na čítanie používateľom, ktorý zapnutie schvaľuje).
 *
 * Mažú sa VÝHRADNE staré súbory reportov (rotácia keep_reports), nikdy žiadne dáta.
 */
class DryRunReporter
{
    /**
     * Report ide do storage/app/<path> presne tak, ako to žiada zadanie.
     *
     * Zámerne NIE Storage::disk('local') — jeho root je v Laraveli 12
     * storage/app/private, takže report by skončil o úroveň nižšie než kam sa
     * pozerá používateľ. Disk sa staví tu, aby balík P2 nemusel meniť zdieľaný
     * config/filesystems.php.
     */
    private function disk(): \Illuminate\Contracts\Filesystem\Filesystem
    {
        return Storage::build([
            'driver' => 'local',
            'root' => storage_path('app'),
            'throw' => true,
        ]);
    }

    /**
     * @param  list<DryRunResult>  $results
     * @return array{json: string, markdown: string}
     */
    public function write(array $results, ?string $stamp = null): array
    {
        $disk = $this->disk();
        $dir = trim((string) config('maintenance.dry_run.path', 'dry-run'), '/');
        $stamp ??= now()->format('Y-m-d_His');

        $jsonPath = "{$dir}/dry-run-{$stamp}.json";
        $mdPath = "{$dir}/dry-run-{$stamp}.md";

        $payload = [
            'generated_at' => now()->toIso8601String(),
            'destructive_enabled' => (bool) config('maintenance.destructive_enabled'),
            'thresholds' => config('maintenance.thresholds'),
            'results' => array_map(fn (DryRunResult $r) => $r->toArray(), $results),
        ];

        $disk->put($jsonPath, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE));
        $disk->put($mdPath, $this->markdown($results));

        $this->rotate($dir);

        return ['json' => $jsonPath, 'markdown' => $mdPath];
    }

    /** @param list<DryRunResult> $results */
    public function markdown(array $results): string
    {
        $enabled = config('maintenance.destructive_enabled') ? 'ZAPNUTÉ' : 'VYPNUTÉ';

        $out = [];
        $out[] = '# Dry-run deštruktívnych jobov — '.now()->format('j. n. Y H:i');
        $out[] = '';
        $out[] = "Deštruktívne joby sú momentálne **{$enabled}** (`config('maintenance.destructive_enabled')`).";
        $out[] = 'Tento report **nič nezmenil** — všetky dotazy boli čítacie.';
        $out[] = '';
        $out[] = 'Zapnutie jobov schvaľuje výhradne používateľ po prečítaní tohto reportu (rozhodnutie #32).';
        $out[] = '';
        $out[] = '## Súhrn';
        $out[] = '';
        $out[] = '| Job | Metrika | Prah | Kandidáti | Vyhodnotené | Dopad | Nerozhodnuté | Trvanie |';
        $out[] = '|---|---|---:|---:|---:|---:|---:|---:|';

        foreach ($results as $r) {
            if ($r->skipped) {
                $out[] = "| `{$r->job}` | {$r->metric} | — | — | — | **preskočené** | — | — |";

                continue;
            }
            $out[] = sprintf(
                '| `%s` | %s | %s | %d | %d | **%d** | %d | %.2f s |',
                $r->job,
                $r->metric,
                rtrim(rtrim(number_format($r->threshold, 4, '.', ''), '0'), '.'),
                $r->candidates,
                $r->compared,
                $r->affected,
                $r->undecided,
                $r->seconds,
            );
        }

        foreach ($results as $r) {
            $out[] = '';
            $out[] = "## `{$r->job}` — metrika `{$r->metric}`";
            $out[] = '';

            if ($r->skipped) {
                $out[] = "**Preskočené:** {$r->skippedReason}";

                continue;
            }

            $out[] = "- prah: **{$r->threshold}**";
            $out[] = "- kandidátov: {$r->candidates}";
            $out[] = "- vyhodnotených: {$r->compared}";
            $out[] = "- dopad (zlúčilo/zmazalo by sa): **{$r->affected}**";
            $out[] = "- ponechaných: {$r->kept}";
            $out[] = "- nerozhodnutých (metrika nedala skóre): {$r->undecided}";
            if ($r->truncated) {
                $out[] = '- ⚠️ **beh zastavil strop `max_pairs` — čísla sú neúplné**';
            }
            $out[] = '';

            foreach ($r->notes as $note) {
                $out[] = "> {$note}";
                $out[] = '';
            }

            if ($r->samples === []) {
                $out[] = '_Žiadne položky — job by pri tomto prahu neurobil nič._';

                continue;
            }

            $out[] = 'Konkrétne položky ('.count($r->samples).' z '.$r->affected.'):';
            $out[] = '';
            $out[] = $this->samplesTable($r);
        }

        return implode("\n", $out)."\n";
    }

    private function samplesTable(DryRunResult $r): string
    {
        $rows = [];

        if ($r->job === 'automerge') {
            $rows[] = '| Skóre | Zostane (id · sila) | ZANIKNE (id · sila) | Typ |';
            $rows[] = '|---:|---|---|---|';
            foreach ($r->samples as $s) {
                $rows[] = sprintf(
                    '| %s | %s (#%d · %.1f) | %s (#%d · %.1f) | %s |',
                    $s['score'],
                    $this->cell($s['winner_label']),
                    $s['winner_id'],
                    $s['winner_strength'],
                    $this->cell($s['loser_label']),
                    $s['loser_id'],
                    $s['loser_strength'],
                    $s['type'],
                );
            }

            return implode("\n", $rows);
        }

        if ($r->job === 'prune-coactivation') {
            $rows[] = '| Skóre | Hrana | Uzol A | Uzol B | Váha |';
            $rows[] = '|---:|---:|---|---|---:|';
            foreach ($r->samples as $s) {
                $rows[] = sprintf(
                    '| %s | #%d | %s (#%d) | %s (#%d) | %.2f |',
                    $s['score'],
                    $s['edge_id'],
                    $this->cell($s['source_label']),
                    $s['source_id'],
                    $this->cell($s['target_label']),
                    $s['target_id'],
                    $s['weight'],
                );
            }

            return implode("\n", $rows);
        }

        $rows[] = '| Hrana | Druh | Váha | Naposledy aktívna | Uzol A | Uzol B | Skóre (info) |';
        $rows[] = '|---:|---|---:|---|---|---|---:|';
        foreach ($r->samples as $s) {
            $rows[] = sprintf(
                '| #%d | %s | %.2f | %s | %s (#%d) | %s (#%d) | %s |',
                $s['edge_id'],
                $s['kind'],
                $s['weight'],
                substr((string) $s['last_activated_at'], 0, 10),
                $this->cell($s['source_label']),
                $s['source_id'],
                $this->cell($s['target_label']),
                $s['target_id'],
                $s['score_info'] === null ? '—' : $s['score_info'],
            );
        }

        return implode("\n", $rows);
    }

    /** Label do tabuľky — zvislá čiara a nové riadky by rozbili Markdown. */
    private function cell(string $label): string
    {
        $label = str_replace(["\r", "\n", '|'], [' ', ' ', '\\|'], $label);
        $label = trim(preg_replace('/\s+/u', ' ', $label) ?? '');

        return mb_strlen($label) > 60 ? mb_substr($label, 0, 59).'…' : $label;
    }

    /** Rotácia: drž len keep_reports najnovších párov json+md. */
    private function rotate(string $dir): void
    {
        $keep = (int) config('maintenance.dry_run.keep_reports', 10);
        if ($keep <= 0) {
            return;
        }

        $disk = $this->disk();
        foreach (['json', 'md'] as $ext) {
            $files = array_values(array_filter(
                $disk->files($dir),
                fn (string $f) => str_ends_with($f, '.'.$ext),
            ));
            rsort($files);
            foreach (array_slice($files, $keep) as $stale) {
                $disk->delete($stale);
            }
        }
    }
}
