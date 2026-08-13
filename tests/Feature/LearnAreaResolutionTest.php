<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Department;
use App\Models\Node;
use App\Services\MindService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Rozlíšenie oblasti a oddelenia pri mind_learn.
 *
 * Do commitu s týmto testom končil každý preklep v `area` tichým fallbackom na
 * oblasť s id 1 a mind_learn vrátil „created" — tak sa React, Docker, Backend,
 * Testing a Accessibility dostali do „Marketing & SEO" a spolu s nimi aj
 * oddelenia, ktoré sa v tej nesprávnej oblasti museli dovytvoriť.
 *
 * Oblasti sú pevná pätica (nikdy sa netvoria za behu), takže neznáme meno je
 * chyba volajúceho a má byť hlasná. Oddelenia naopak zámerne rastú, tie sa
 * vytvárať smú — len sa už neduplikujú na diakritike/entite a vytvorenie je
 * v odpovedi vidno.
 */
class LearnAreaResolutionTest extends TestCase
{
    use RefreshDatabase;

    private const TOKEN = 'test-mcp-token';

    private MindService $mind;

    private Area $marketing;

    private Area $vyvoj;

    private Area $biznis;

    protected function setUp(): void
    {
        parent::setUp();

        config(['hades.mcp_token' => self::TOKEN, 'cache.default' => 'array']);

        $this->mind = app(MindService::class);

        // poradie zodpovedá produkcii: Marketing & SEO je oblasť s id 1, teda
        // presne tá, do ktorej doteraz padalo všetko nerozlíšené
        $this->marketing = Area::create(['name' => 'Marketing & SEO', 'slug' => 'marketing-seo', 'color' => '#c2410c', 'angle' => 0]);
        $this->vyvoj = Area::create(['name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 90]);
        $this->biznis = Area::create(['name' => 'Biznis & projekty', 'slug' => 'biznis-projekty', 'color' => '#d8b878', 'angle' => 180]);

        Department::create(['area_id' => $this->biznis->id, 'name' => 'Aplikácie', 'slug' => 'aplikacie']);
        Department::create(['area_id' => $this->marketing->id, 'name' => 'Reporting & dataviz', 'slug' => 'reporting-dataviz']);
    }

    private function callTool(string $tool, array $args = []): TestResponse
    {
        return $this->withHeader('Authorization', 'Bearer '.self::TOKEN)
            ->postJson('/mcp', [
                'jsonrpc' => '2.0',
                'id' => 1,
                'method' => 'tools/call',
                'params' => ['name' => $tool, 'arguments' => $args],
            ]);
    }

    private function payload(TestResponse $res): array
    {
        return json_decode($res->json('result.content.0.text'), true);
    }

    /** @return array{0: TestResponse, 1: string} odpoveď + text chyby */
    private function learnExpectingError(array $args): array
    {
        $res = $this->callTool('mind_learn', $args)->assertOk();

        $this->assertTrue($res->json('result.isError'), 'malo skončiť chybou');

        return [$res, (string) $res->json('result.content.0.text')];
    }

    // ---- oblasť: neznáme meno už neprejde ----------------------------------

    public function test_learn_refuses_an_unknown_area_instead_of_filing_it_under_the_first_one(): void
    {
        [, $text] = $this->learnExpectingError([
            'type' => 'skill',
            'label' => 'React',
            'area' => 'Frontend & UI',
        ]);

        $this->assertStringContainsString('Neznáma oblasť', $text);
        $this->assertSame(0, Node::count(), 'uzol nesmie vzniknúť ani v oblasti s id 1');
    }

    public function test_the_refusal_lists_the_valid_areas_so_the_caller_can_fix_the_call(): void
    {
        [, $text] = $this->learnExpectingError([
            'type' => 'memory',
            'label' => 'Nejaký fakt',
            'area' => 'Neexistujúca oblasť',
        ]);

        foreach (['Marketing & SEO', 'Vývoj & kód', 'Biznis & projekty'] as $name) {
            $this->assertStringContainsString($name, $text);
        }
    }

    public function test_the_error_arrives_as_a_tool_result_not_as_a_broken_jsonrpc_call(): void
    {
        // živé session by inak videli spadnutý nástroj namiesto vety, z ktorej
        // sa vie poučiť — preto isError v result, nie JSON-RPC error
        $res = $this->callTool('mind_learn', [
            'type' => 'skill',
            'label' => 'Docker',
            'area' => 'DevOps',
        ])->assertOk();

        $this->assertNull($res->json('error'), 'JSON-RPC chyba by nástroj zhodila');
        $this->assertTrue($res->json('result.isError'));
        $this->assertIsString($res->json('result.content.0.text'));
    }

    public function test_an_ambiguous_area_is_refused_rather_than_resolved_by_lowest_id(): void
    {
        // '&' sedí na všetky tri oblasti — doteraz vyhrala tá s najnižším id
        [, $text] = $this->learnExpectingError([
            'type' => 'memory',
            'label' => 'Fakt s nejednoznačnou oblasťou',
            'area' => '&',
        ]);

        $this->assertStringContainsString('Nejednoznačná oblasť', $text);
        $this->assertSame(0, Node::count());
    }

    // ---- oblasť: čo fungovalo, funguje ďalej -------------------------------

    public function test_an_exact_area_name_still_works(): void
    {
        $data = $this->payload($this->callTool('mind_learn', [
            'type' => 'skill',
            'label' => 'Laravel queues',
            'area' => 'Vývoj & kód',
        ])->assertOk());

        $this->assertSame('created', $data['action']);
        $this->assertSame($this->vyvoj->id, Node::where('label', 'Laravel queues')->first()->area_id);
    }

    public function test_a_slug_still_works(): void
    {
        $this->mind->learn('skill', 'Redis caching', null, 'vyvoj-kod');

        $this->assertSame($this->vyvoj->id, Node::where('label', 'Redis caching')->first()->area_id);
    }

    public function test_a_short_but_unambiguous_area_still_lands_where_it_did_before(): void
    {
        // skratky ako „Vývoj" mierili doteraz správne — sprísnenie ich nesmie
        // rozbiť, inak by chyboval každý živý caller, ktorý ich používa
        $this->mind->learn('skill', 'PHPUnit', null, 'Vývoj');

        $this->assertSame($this->vyvoj->id, Node::where('label', 'PHPUnit')->first()->area_id);
    }

    public function test_an_area_without_diacritics_lands_correctly(): void
    {
        $this->mind->learn('skill', 'Nginx tuning', null, 'Vyvoj & kod');

        $this->assertSame($this->vyvoj->id, Node::where('label', 'Nginx tuning')->first()->area_id);
    }

    public function test_an_entity_escaped_area_name_lands_correctly(): void
    {
        $this->mind->learn('skill', 'MariaDB indexy', null, 'Vývoj &amp; kód');

        $this->assertSame($this->vyvoj->id, Node::where('label', 'MariaDB indexy')->first()->area_id);
    }

    public function test_a_blank_area_still_falls_back_to_the_first_area(): void
    {
        // POST /api/knowledge má `area` nullable a posiela '' — prázdno nie je
        // preklep, ale „volajúci oblasť neuviedol"
        $this->mind->learn('memory', 'Fakt bez oblasti', null, '');

        $this->assertSame($this->marketing->id, Node::where('label', 'Fakt bez oblasti')->first()->area_id);
    }

    public function test_the_api_still_accepts_a_node_without_an_area(): void
    {
        config(['hades.api_token' => 'test-api-token', 'hades.allow_brain_write' => false]);

        $res = $this->withToken('test-api-token')->postJson('/api/v1/knowledge', [
            'label' => 'Uzol bez oblasti',
            'type' => 'memory',
        ])->assertStatus(201);

        $this->assertSame($this->marketing->id, Node::where('label', 'Uzol bez oblasti')->first()->area_id);
        $this->assertSame('created', $res->json('action'));
    }

    public function test_merging_an_existing_node_does_not_care_about_the_area(): void
    {
        // zlúčenie oblasť vôbec nerieši (uzol už niekde je), takže sprísnenie
        // sa tejto vetvy nesmie dotknúť
        $this->mind->learn('skill', 'Docker Compose', 'prvý popis', 'Vývoj & kód');

        $result = $this->mind->learn('skill', 'Docker Compose', 'druhý popis', 'Úplne neznáma oblasť');

        $this->assertSame('merged', $result['action']);
        $this->assertSame($this->vyvoj->id, Node::where('label', 'Docker Compose')->first()->area_id);
    }

    // ---- oddelenie: tvoriť sa smie, duplikovať nie ------------------------

    public function test_a_department_differing_only_in_diacritics_reuses_the_existing_one(): void
    {
        $before = Department::count();

        $result = $this->mind->learn('project', 'Aura KPI', null, 'Biznis & projekty', 'aplikacie');

        $this->assertSame($before, Department::count(), 'nesmie vzniknúť dvojča k „Aplikácie"');
        $this->assertSame('Aplikácie', Node::where('label', 'Aura KPI')->first()->department->name);
        $this->assertArrayNotHasKey('department_created', $result);
    }

    public function test_a_department_differing_only_in_an_html_entity_reuses_the_existing_one(): void
    {
        $before = Department::count();

        $this->mind->learn('memory', 'Týždenný report', null, 'Marketing & SEO', 'Reporting &amp; dataviz');

        $this->assertSame($before, Department::count());
        $this->assertSame('Reporting & dataviz', Node::where('label', 'Týždenný report')->first()->department->name);
    }

    public function test_a_genuinely_new_department_is_still_created_but_reported(): void
    {
        // taxonómia oddelení zámerne rastie — toto je jediná cesta, ktorou ju
        // session vie doplniť, len to už nie je nevidno
        $result = $this->mind->learn('skill', 'OpenTelemetry', null, 'Vývoj & kód', 'Observability');

        $this->assertSame('Observability', $result['department_created']);
        $this->assertSame('Observability', Node::where('label', 'OpenTelemetry')->first()->department->name);
    }

    public function test_a_new_department_lands_in_the_requested_area_only(): void
    {
        $this->mind->learn('skill', 'Grafana', null, 'Vývoj & kód', 'Observability');

        $dept = Department::where('name', 'Observability')->sole();
        $this->assertSame($this->vyvoj->id, $dept->area_id);
    }

    public function test_a_whitespace_only_department_does_not_create_an_empty_one(): void
    {
        // ' ' je v PHP truthy, takže doteraz prešla až po departments()->create()
        // s prázdnym menom aj slugom
        $before = Department::count();

        $this->mind->learn('memory', 'Fakt s medzerou', null, 'Vývoj & kód', ' ');

        $this->assertSame($before, Department::count());
        $this->assertNull(Node::where('label', 'Fakt s medzerou')->first()->department_id);
    }
}
