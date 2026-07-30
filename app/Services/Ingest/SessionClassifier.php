<?php

namespace App\Services\Ingest;

use App\Models\Area;
use App\Models\Department;
use Illuminate\Support\Str;

/**
 * KLASIFIKÁTOR — projekt session → oblasť + oddelenie „Záznamy — <projekt>".
 *
 * Vyčlenené z {@see \App\Services\TranscriptIngestService} (W2/P3) bez zmeny
 * chovania. Mapovanie je deterministické a konfiguračné
 * (`config('auraai.project_area_map')`), model doň nezasahuje — rozhodnutie #131
 * (LLM klasifikácia oblasti) je vecou samostatnej úlohy a vyžaduje explicitný
 * fallback namiesto dnešného tichého.
 */
class SessionClassifier
{
    /**
     * Projekt → oblasť podľa config('auraai.project_area_map'); case-insensitive,
     * skúša aj čiastočnú zhodu (contains oboma smermi). Fallback z configu.
     */
    public function resolveArea(?string $project): ?Area
    {
        $map = (array) config('auraai.project_area_map', []);
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

        $slug ??= (string) config('auraai.project_area_fallback', 'vyvoj-kod');

        return Area::where('slug', $slug)->first() ?? Area::orderBy('id')->first();
    }

    /**
     * Oblasť + emergentné oddelenie záznamov projektu.
     *
     * @return array{0: ?Area, 1: ?Department}
     */
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
}
