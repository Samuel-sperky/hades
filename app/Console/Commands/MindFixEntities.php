<?php

namespace App\Console\Commands;

use App\Models\Decision;
use App\Models\Department;
use App\Models\Node;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * Jednorazová náprava historických záznamov, do ktorých sa cez mind_learn /
 * mind_decision dostali HTML entity („Procesy &amp; prevádzka") alebo zvyšok
 * JSON escapovania (`\"`).
 *
 * Server sám nikdy neescapoval — entity prišli už v argumentoch nástroja.
 * Write path je opravený samostatne (MindService::decodeName pre názvy oblastí
 * a oddelení); tento príkaz len upratuje, čo už v databáze leží.
 *
 * Beh je NAPREV suchý. Zápis až s --apply, a vždy až po mysqldump zálohe.
 */
class MindFixEntities extends Command
{
    protected $signature = 'mind:fix-entities {--apply : Naozaj zapíš zmeny (inak len ukáž, čo by sa zmenilo)}';

    protected $description = 'Opraví HTML entity a zvyšky JSON escapovania v uzloch, rozhodnutiach a názvoch oddelení';

    /**
     * Záznamy, kde je entita LEGITÍMNY obsah — sú to práve tie, ktoré pred
     * escapovaným variantom varujú. Dekódovať ich by zmazalo ich zmysel.
     */
    protected const KEEP_NODES = [2092, 2094, 2116, 2176];

    protected const KEEP_DECISIONS = [29, 39];

    public function handle(): int
    {
        $apply = (bool) $this->option('apply');
        $rows = [];

        $rows = array_merge(
            $rows,
            $this->scanDecisions($apply),
            $this->scanNodes($apply),
            $this->scanDepartments($apply),
        );

        if ($rows === []) {
            $this->info('Niet čo opravovať.');
        } else {
            $this->table(['Tabuľka', 'ID', 'Stĺpec', 'Pred', 'Po'], $rows);

            $this->newLine();
            $this->line($apply
                ? '<info>Zapísané: '.count($rows).' zmien.</info>'
                : '<comment>Suchý beh — nič sa nezmenilo. Zápis: php artisan mind:fix-entities --apply</comment>');
        }

        // aj pri čistom behu — nevybavené zlúčenie nesmie ticho zmiznúť
        $this->warnAboutMerges();

        return self::SUCCESS;
    }

    /**
     * Jeden dekódovací krok. `&amp;` ide zámerne POSLEDNÝ, aby sa `&amp;nbsp;`
     * opravilo na `&nbsp;` a nie ďalej — dekóduje sa práve jedna vrstva.
     * Zároveň sa odstráni osamotené `\"` z JSON escapovania.
     */
    public static function fix(string $value): string
    {
        $value = str_replace('\\"', '"', $value);

        return str_replace(
            ['&lt;', '&gt;', '&quot;', '&#039;', '&#39;', '&amp;'],
            ['<', '>', '"', "'", "'", '&'],
            $value,
        );
    }

    protected function needsFix(?string $value): bool
    {
        return $value !== null && $value !== '' && self::fix($value) !== $value;
    }

    /** @return array<int, array<int, string>> */
    protected function scanDecisions(bool $apply): array
    {
        $rows = [];

        foreach (Decision::orderBy('id')->get() as $decision) {
            if (in_array($decision->id, self::KEEP_DECISIONS, true)) {
                continue;
            }

            foreach (['text', 'reason'] as $column) {
                if (! $this->needsFix($decision->{$column})) {
                    continue;
                }

                $rows[] = $this->row('decisions', $decision->id, $column, $decision->{$column});

                if ($apply) {
                    $decision->{$column} = self::fix($decision->{$column});
                }
            }

            if ($apply && $decision->isDirty()) {
                $decision->save();
            }
        }

        return $rows;
    }

    /** @return array<int, array<int, string>> */
    protected function scanNodes(bool $apply): array
    {
        $rows = [];

        // `meta` je JSON — spätné lomítka sú tam korektné kódovanie, nie chyba.
        foreach (Node::orderBy('id')->get() as $node) {
            if (in_array($node->id, self::KEEP_NODES, true)) {
                continue;
            }

            foreach (['label', 'description'] as $column) {
                if (! $this->needsFix($node->{$column})) {
                    continue;
                }

                $rows[] = $this->row('nodes', $node->id, $column, $node->{$column});

                if ($apply) {
                    $node->{$column} = self::fix($node->{$column});
                }
            }

            if ($apply && $node->isDirty()) {
                $node->save();
            }
        }

        return $rows;
    }

    /**
     * Premenujú sa len oddelenia, ktoré po dekódovaní NEKOLIDUJÚ s existujúcim.
     * Kolízie sú zlúčenie (presun uzlov + zmazanie riadku) — to je deštruktívna
     * operácia a robí sa ručne, nie týmto príkazom.
     *
     * @return array<int, array<int, string>>
     */
    protected function scanDepartments(bool $apply): array
    {
        $rows = [];

        foreach (Department::orderBy('id')->get() as $department) {
            if (! $this->needsFix($department->name)) {
                continue;
            }

            $decoded = self::fix($department->name);

            if ($this->twinOf($department, $decoded) !== null) {
                continue; // kolízia → ručné zlúčenie
            }

            $rows[] = $this->row('departments', $department->id, 'name', $department->name);

            if ($apply) {
                $department->name = $decoded;
                $department->slug = Str::slug($decoded);
                $department->save();
            }
        }

        return $rows;
    }

    protected function twinOf(Department $department, string $decoded): ?Department
    {
        return Department::where('area_id', $department->area_id)
            ->whereKeyNot($department->getKey())
            ->get()
            ->first(fn (Department $d) => mb_strtolower($d->name) === mb_strtolower($decoded));
    }

    protected function warnAboutMerges(): void
    {
        $merges = [];

        foreach (Department::orderBy('id')->get() as $department) {
            if (! $this->needsFix($department->name)) {
                continue;
            }

            if ($twin = $this->twinOf($department, self::fix($department->name))) {
                $merges[] = [
                    $department->id,
                    $department->name,
                    $twin->id,
                    $twin->name,
                    (string) Node::where('department_id', $department->id)->count(),
                ];
            }
        }

        if ($merges === []) {
            return;
        }

        $this->newLine();
        $this->warn('Kolidujúce oddelenia — NEOPRAVENÉ, treba ručné zlúčenie (presun uzlov + zmazanie):');
        $this->table(['ID', 'Názov', 'Zlúčiť do ID', 'Kanonický názov', 'Uzlov'], $merges);
    }

    /** @return array<int, string> */
    protected function row(string $table, int $id, string $column, string $before): array
    {
        return [$table, (string) $id, $column, $this->excerpt($before), $this->excerpt(self::fix($before))];
    }

    /** Výrez okolo prvej zmeny, aby bola tabuľka čitateľná aj pri dlhom texte. */
    protected function excerpt(string $value): string
    {
        if (mb_strlen($value) <= 90) {
            return $value;
        }

        $at = 0;
        foreach (['&lt;', '&gt;', '&quot;', '&#039;', '&#39;', '&amp;', '\\"'] as $needle) {
            if (($pos = mb_strpos($value, $needle)) !== false) {
                $at = $pos;
                break;
            }
        }

        $start = max(0, $at - 35);

        return ($start > 0 ? '…' : '').mb_substr($value, $start, 90).'…';
    }
}
