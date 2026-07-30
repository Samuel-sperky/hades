<?php

namespace App\Services\Similarity;

use App\Events\MindPulse;
use App\Models\Area;
use App\Models\Department;
use App\Services\Recall\QueryAnalyzer;
use Illuminate\Support\Str;

/**
 * Zaradenie poznatku do taxonómie (5 fixných oblastí + emergentné oddelenia).
 * Vyčlenené z `MindService`, lebo je to fuzzy porovnávanie názvov, nie logika
 * učenia.
 *
 * OPRAVA BUGU z 29. 7. 2026 (`04-ODPOVEDE-ZAZNAM.md`): pôvodný `resolveArea()`
 * pri nezhode potichu vrátil PRVÚ oblasť (`Marketing & SEO`) a
 * `resolveDepartment()` v nej potom vytvoril duplicitné oddelenie. Stačil na to
 * preklep alebo HTML entita v argumente (`Biznis &amp; projekty`) — presne tak
 * vznikol duplikát „Aplikácie" (id 72, area_id 1) vedľa existujúceho (id 8, area_id 4).
 *
 * Nové chovanie:
 *   - vstup sa normalizuje: HTML entity (aj dvojito zakódované), whitespace, diakritika
 *   - zhoda v štyroch krokoch: presný názov → slug → obojsmerný `contains` →
 *     podmnožina tokenov
 *   - pri nezhode sa uzol NEZARADÍ potichu — vráti sa `review` a `MindService`
 *     mu nastaví `needs_review = true` + `meta.taxonomy_review`
 *   - oddelenie sa NEVYTVORÍ, keď oblasť nesedela, ani keď oddelenie toho istého
 *     názvu už existuje v INEJ oblasti
 *
 * Nič nemaže a nič nepresúva — existujúce duplikáty rieši samostatný audit.
 */
class TaxonomyResolver
{
    /** Spojky, ktoré v názve oblasti nenesú význam ('Biznis & projekty'). */
    private const IGNORED_TOKENS = ['a', 'and', 'the'];

    public function __construct(private readonly QueryAnalyzer $analyzer = new QueryAnalyzer) {}

    /**
     * @return array{area: Area, department: ?Department, review: ?array<string, mixed>}
     */
    public function place(string $areaName, ?string $departmentName = null): array
    {
        $match = $this->matchArea($areaName);
        $area = $match['area'];

        if (! $match['matched']) {
            $review = [
                'reason' => 'area_not_matched',
                'requested_area' => trim($areaName),
                'assigned_area_id' => $area->id,
                'assigned_area' => $area->name,
                'note' => 'Oblasť sa nepodarilo priradiť — uzol čaká na kontrolu.',
                'at' => now()->toIso8601String(),
            ];

            if ($departmentName !== null && trim($departmentName) !== '') {
                $review['requested_department'] = trim($departmentName);
                $review['note'] .= ' Oddelenie sa preto nevytvorilo.';
            }

            // Bez správnej oblasti sa oddelenie nezakladá — inak vzniknú duplikáty.
            return ['area' => $area, 'department' => null, 'review' => $review];
        }

        if ($departmentName === null || trim($departmentName) === '') {
            return ['area' => $area, 'department' => null, 'review' => null];
        }

        $department = $this->findDepartment($area, $departmentName);
        if ($department) {
            return ['area' => $area, 'department' => $department, 'review' => null];
        }

        // Existuje oddelenie s rovnakým názvom v inej oblasti? Duplikát sa
        // NEVYTVÁRA — rozhodne o tom používateľ v kontrolnej fronte.
        $elsewhere = $this->departmentsElsewhere($area, $departmentName);
        if ($elsewhere !== []) {
            return [
                'area' => $area,
                'department' => null,
                'review' => [
                    'reason' => 'department_exists_in_other_area',
                    'requested_department' => trim($departmentName),
                    'area_id' => $area->id,
                    'area' => $area->name,
                    'existing' => $elsewhere,
                    'note' => 'Oddelenie rovnakého názvu existuje v inej oblasti — '
                        .'duplikát sa nevytvoril, uzol čaká na kontrolu.',
                    'at' => now()->toIso8601String(),
                ],
            ];
        }

        return [
            'area' => $area,
            'department' => $this->createDepartment($area, $departmentName),
            'review' => null,
        ];
    }

    /**
     * Nájde oblasť podľa názvu. `matched = false` znamená „nenašlo sa" — vtedy je
     * `area` len núdzové zaradenie (prvá podľa id) a volajúci to MUSÍ oznámiť.
     * Oblasť sa priradiť musí: stĺpec je povinný a bez nej graf uzol nevykreslí.
     *
     * @return array{area: Area, matched: bool}
     */
    public function matchArea(string $name): array
    {
        $areas = Area::orderBy('id')->get();
        $wanted = $this->normalize($name);
        $wantedSlug = Str::slug($wanted);
        $wantedTokens = $this->tokens($wanted);

        $fallback = $areas->first() ?? Area::orderBy('id')->firstOrFail();

        if ($wanted === '') {
            return ['area' => $fallback, 'matched' => false];
        }

        // 1) presný názov
        $hit = $areas->first(fn (Area $a) => $this->normalize($a->name) === $wanted);

        // 2) slug — takto prichádza 'vyvoj-kod' z MCP aj z /api
        $hit ??= $areas->first(function (Area $a) use ($wantedSlug) {
            if ($wantedSlug === '') {
                return false;
            }

            return $a->slug === $wantedSlug || Str::slug($this->normalize($a->name)) === $wantedSlug;
        });

        // 3) obojsmerný contains — pôvodné chovanie, ale nad normalizovaným textom
        //    a s minimálnou dĺžkou 3, takže prázdny vstup už netrafí prvú oblasť
        $hit ??= $areas->first(function (Area $a) use ($wanted) {
            $areaName = $this->normalize($a->name);

            return mb_strlen($wanted) >= 3
                && (str_contains($areaName, $wanted) || str_contains($wanted, $areaName));
        });

        // 4) podmnožina tokenov — 'biznis a projekty' nájde 'Biznis & projekty'
        $hit ??= $areas->first(function (Area $a) use ($wantedTokens) {
            if ($wantedTokens === []) {
                return false;
            }

            $areaTokens = $this->tokens($this->normalize($a->name));
            if ($areaTokens === []) {
                return false;
            }

            return array_diff($wantedTokens, $areaTokens) === []
                || array_diff($areaTokens, $wantedTokens) === [];
        });

        return $hit
            ? ['area' => $hit, 'matched' => true]
            : ['area' => $fallback, 'matched' => false];
    }

    /** Oddelenie daného názvu v TEJTO oblasti (názov aj slug, necitlivé na diakritiku). */
    public function findDepartment(Area $area, string $name): ?Department
    {
        $wanted = $this->normalize($name);
        $wantedSlug = Str::slug($wanted);

        return $area->departments->first(function (Department $d) use ($wanted, $wantedSlug) {
            return $this->normalize($d->name) === $wanted
                || ($wantedSlug !== '' && $d->slug === $wantedSlug);
        });
    }

    /**
     * Oddelenia rovnakého názvu v INÝCH oblastiach — vstup do kontrolnej fronty
     * aj do jednorazového auditu duplikátov.
     *
     * @return list<array{id: int, area_id: int, name: string, nodes: int}>
     */
    public function departmentsElsewhere(Area $area, string $name): array
    {
        $wanted = $this->normalize($name);
        $wantedSlug = Str::slug($wanted);

        return Department::query()
            ->where('area_id', '!=', $area->id)
            ->withCount('nodes')
            ->get()
            ->filter(function (Department $d) use ($wanted, $wantedSlug) {
                return $this->normalize($d->name) === $wanted
                    || ($wantedSlug !== '' && $d->slug === $wantedSlug);
            })
            ->map(fn (Department $d) => [
                'id' => (int) $d->id,
                'area_id' => (int) $d->area_id,
                'name' => (string) $d->name,
                'nodes' => (int) $d->nodes_count,
            ])
            ->values()
            ->all();
    }

    protected function createDepartment(Area $area, string $name): Department
    {
        $department = $area->departments()->create([
            'name' => trim($name),
            'slug' => Str::slug($name),
        ]);

        // relácia je nacachovaná — bez zhodenia by ďalší learn v tej istej
        // požiadavke oddelenie „nevidel" a skúsil ho založiť znovu
        $area->unsetRelation('departments');

        MindPulse::dispatch('department.created', [
            'department' => [
                'id' => $department->id,
                'area_id' => $area->id,
                'name' => $department->name,
            ],
        ]);

        return $department;
    }

    /**
     * Normalizácia názvu pred porovnaním: HTML entity (`&amp;` → `&`, aj dvojito
     * zakódované), zbalenie whitespace, lowercase a odstránenie diakritiky.
     * Bez tohto kroku zhodí zaradenie jediná entita v argumente `mind_learn`.
     */
    public function normalize(string $name): string
    {
        $value = $name;
        for ($i = 0; $i < 2 && str_contains($value, '&'); $i++) {
            $decoded = html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
            if ($decoded === $value) {
                break;
            }
            $value = $decoded;
        }

        $value = preg_replace('/\s+/u', ' ', $value) ?? $value;

        return $this->analyzer->fold(trim($value));
    }

    /**
     * Významové tokeny názvu (bez spojok a interpunkcie) pre porovnanie
     * podmnožinou. 'biznis & projekty' → ['biznis', 'projekty'].
     *
     * @return list<string>
     */
    public function tokens(string $normalized): array
    {
        $raw = preg_split('/[^a-z0-9]+/u', $normalized, -1, PREG_SPLIT_NO_EMPTY) ?: [];

        $tokens = array_values(array_unique(array_filter(
            $raw,
            fn (string $t) => mb_strlen($t) >= 3 && ! in_array($t, self::IGNORED_TOKENS, true),
        )));

        sort($tokens);

        return $tokens;
    }
}
