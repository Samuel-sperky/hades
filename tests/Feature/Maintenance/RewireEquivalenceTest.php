<?php

namespace Tests\Feature\Maintenance;

use App\Models\Area;
use App\Models\Department;
use App\Models\Edge;
use App\Models\Node;
use App\Services\Maintenance\Rewire\RewireBudget;
use App\Services\Maintenance\Rewire\RewireOrchestrator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

/**
 * Brána pre rozpad MindRewire na triedy (rozhodnutie #41): nový orchestrátor musí
 * vyrobiť BIT-ZA-BITOM tú istú množinu hrán ako pôvodný 672-riadkový príkaz.
 *
 * Test to overuje priamo: nad tou istou fixtúrou spustí orchestrátor, odfotí hrany,
 * vráti graf do pôvodného stavu a spustí `mind:rewire`. Snapshoty sa musia zhodovať
 * vrátane kind, auto, váhy a stĺpca relation.
 *
 * Ak niekto v budúcnosti zmení jeden z dvoch kódov, tento test padne — presne to
 * je jeho účel, kým v repozitári žijú obe implementácie.
 */
class RewireEquivalenceTest extends TestCase
{
    use RefreshDatabase;

    /** @var list<int> id hrán, ktoré existovali pred behom */
    private array $seedEdgeIds = [];

    public function test_orchestrator_produces_the_same_edges_as_the_original_command(): void
    {
        $this->seedNetwork();
        $this->seedEdgeIds = Edge::query()->orderBy('id')->pluck('id')->all();

        $result = app(RewireOrchestrator::class)->run(RewireBudget::unlimited());
        $fromClasses = $this->snapshot();

        $this->resetToSeed();
        Artisan::call('mind:rewire');
        $fromMonolith = $this->snapshot();

        $this->assertSame(
            $fromMonolith,
            $fromClasses,
            'Rozpad MindRewire na triedy zmenil výsledok — hrany sa nezhodujú s pôvodným príkazom.',
        );

        // sanity: fixtúra musí niečo vyrobiť, inak by test prešiel aj pri prázdnom behu
        $this->assertGreaterThan(0, count($fromClasses), 'Fixtúra nevyrobila žiadnu hranu — test by bol bezcenný.');
        $this->assertGreaterThan(0, $result->checked);
    }

    public function test_budget_stops_the_run_and_reports_which_cap_fired(): void
    {
        $this->seedNetwork();

        // strop 0 párov ⇒ padne hneď pri prvom uzle
        $budget = new RewireBudget(maxSeconds: 0, maxPairs: 1, maxNodes: 0);
        $result = app(RewireOrchestrator::class)->run($budget);

        $this->assertSame('max_pairs', $result->cappedBy);
        $this->assertNotEmpty($result->skippedSteps, 'Pri vyčerpanom strope sa ďalšie algoritmy nesmú spustiť.');
        $this->assertStringContainsString('Zastavené stropom max_pairs', $result->summary());
    }

    public function test_run_is_idempotent(): void
    {
        $this->seedNetwork();

        app(RewireOrchestrator::class)->run(RewireBudget::unlimited());
        $first = $this->snapshot();

        $second = app(RewireOrchestrator::class)->run(RewireBudget::unlimited());

        $this->assertSame($first, $this->snapshot(), 'Druhý beh nesmie zmeniť ani jednu hranu.');
        $this->assertSame(0, $second->simCreated);
        $this->assertSame(0, $second->bridged);
        $this->assertSame(0, $second->clustered);
        $this->assertSame(0, $second->depted);
        $this->assertSame(0, $second->sessioned);
    }

    public function test_timings_are_recorded_per_algorithm(): void
    {
        $this->seedNetwork();

        $result = app(RewireOrchestrator::class)->run(RewireBudget::unlimited());

        foreach (['A3+A4', 'A5', 'A6', 'A7', 'A8', 'A11'] as $step) {
            $this->assertArrayHasKey($step, $result->timings, "Chýba meranie času pre {$step}.");
        }
    }

    // ------------------------------------------------------------------

    /**
     * Kanonický odtlačok hrán — nezávislý od id hrany a od poradia vloženia.
     *
     * @return list<string>
     */
    private function snapshot(): array
    {
        $rows = Edge::query()
            ->orderBy('source_id')
            ->orderBy('target_id')
            ->get(['source_id', 'target_id', 'kind', 'auto', 'weight', 'relation'])
            ->map(fn (Edge $e) => implode('|', [
                $e->source_id,
                $e->target_id,
                (string) $e->kind,
                $e->auto ? '1' : '0',
                number_format((float) $e->weight, 4, '.', ''),
                (string) ($e->relation ?? '-'),
            ]))
            ->all();

        sort($rows);

        return $rows;
    }

    /**
     * Vráti graf do stavu po seedNetwork(): zmaže hrany, ktoré beh vytvoril,
     * a vynuluje relation na tých pôvodných.
     *
     * Mazanie beží v testovacej databáze auraai_test, ktorú RefreshDatabase
     * migruje nanovo — živých dát sa nedotýka.
     */
    private function resetToSeed(): void
    {
        Edge::query()->whereNotIn('id', $this->seedEdgeIds)->delete();
        Edge::query()->update(['relation' => null, 'kind' => 'co_activation', 'weight' => 1, 'auto' => true]);
    }

    /**
     * Malá, ale netriviálna sieť: pokrýva A3 (podobné skilly), A4 (session záznam
     * so skill zmienkami v meta), A5 (cross-department zdieľané tokeny labelu),
     * A6 (klaster 'eshop' s hub uzlom), A7 (memory s meta.project), A8 (oddelenie
     * s 3+ členmi) a A11 (relation uses/part_of).
     */
    private function seedNetwork(): void
    {
        $areaA = Area::create(['slug' => 'vyvoj-kod', 'name' => 'Vývoj & kód', 'color' => '#03797e', 'angle' => 342]);
        $areaB = Area::create(['slug' => 'biznis-projekty', 'name' => 'Biznis & projekty', 'color' => '#2f6d8f', 'angle' => 126]);

        $devDept = Department::create(['area_id' => $areaA->id, 'slug' => 'backend', 'name' => 'Backend']);
        $shopDept = Department::create(['area_id' => $areaB->id, 'slug' => 'eshop', 'name' => 'E-shop']);

        $mk = fn (array $attrs) => Node::create(array_merge([
            'type' => 'skill',
            'area_id' => $areaA->id,
            'strength' => 1,
            'last_activated_at' => now(),
        ], $attrs));

        // core — musí sa preskočiť
        $mk(['type' => 'core', 'label' => 'AuraAI', 'department_id' => null]);

        // A6 klaster 'eshop' — hub + členovia (>= 3 členov)
        $mk(['label' => 'Eshop ekosystém mapa', 'department_id' => $shopDept->id, 'area_id' => $areaB->id, 'strength' => 5]);
        $mk(['label' => 'Eshop import produktov', 'department_id' => $shopDept->id, 'area_id' => $areaB->id]);
        $mk(['label' => 'Eshop cenotvorba pricing', 'department_id' => $shopDept->id, 'area_id' => $areaB->id]);

        // A8 hviezda v oddelení Backend (3..12 členov) + A3 podobné popisy
        $mk([
            'label' => 'MariaDB replikácia',
            'department_id' => $devDept->id,
            'description' => 'Nastavenie replikácie MariaDB, binlog, GTID pozície a monitoring replikačného oneskorenia.',
        ]);
        $mk([
            'label' => 'MariaDB záloha rotation',
            'department_id' => $devDept->id,
            'description' => 'Nastavenie replikácie MariaDB, binlog, GTID pozície a monitoring replikačného oneskorenia.',
        ]);
        $mk([
            'label' => 'Redis cache architecture',
            'department_id' => $devDept->id,
            'description' => 'Cache vrstva v Redise, TTL, invalidácia kľúčov.',
        ]);

        // A5 cross-department: zdieľa 2 tokeny labelu s uzlom v inom oddelení
        $mk(['label' => 'MariaDB replikácia audit', 'department_id' => $shopDept->id, 'area_id' => $areaB->id]);

        // A7 — projekt + memory so meta.project
        $project = $mk(['type' => 'project', 'label' => 'Aura Eshop', 'department_id' => $shopDept->id, 'area_id' => $areaB->id]);
        $mk([
            'type' => 'memory',
            'source' => 'claude-memory',
            'label' => 'Poznámka k eshopu',
            'department_id' => $shopDept->id,
            'area_id' => $areaB->id,
            'meta' => ['project' => $project->label],
        ]);

        // A4 — session záznam, ktorý v texte zmieňuje skilly
        $mk([
            'type' => 'memory',
            'source' => 'session',
            'label' => 'Session 2026-07-30',
            'department_id' => $devDept->id,
            'meta' => [
                'project' => 'Aura Eshop',
                'prompts' => ['Nastav MariaDB replikáciu a binlog', 'Skontroluj Redis cache architecture'],
                'final' => 'Replikácia MariaDB beží, Redis cache invalidácia dorobená.',
            ],
        ]);
    }
}
