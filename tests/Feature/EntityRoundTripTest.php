<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Decision;
use App\Models\Node;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Sondáž: prejde `&` a `<tag>` write pathom nezmenené, alebo sa niekde
 * zaescapuje na &amp; / &lt;?
 */
class EntityRoundTripTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'hades.allow_brain_write' => false,
            'hades.mcp_token' => 'test-mcp-token',
            'cache.default' => 'array',
        ]);

        Area::create(['name' => 'Vývoj / kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0]);
    }

    private function rpc(string $method, array $params = [], int $id = 1): TestResponse
    {
        return $this->withHeader('Authorization', 'Bearer test-mcp-token')
            ->postJson('/mcp', [
                'jsonrpc' => '2.0',
                'id' => $id,
                'method' => $method,
                'params' => $params,
            ]);
    }

    private function callTool(string $tool, array $args = []): array
    {
        $res = $this->rpc('tools/call', ['name' => $tool, 'arguments' => $args])->assertOk();
        $text = $res->json('result.content.0.text');

        return json_decode($text, true);
    }

    public function test_decision_text_round_trips_ampersand(): void
    {
        $text = 'Nový department „Procesy & prevádzka" má <b>plný</b> runbook.';

        $this->callTool('mind_decision', ['text' => $text, 'area' => 'Vývoj / kód']);

        $stored = Decision::latest('id')->first();
        $this->assertSame($text, $stored->text, 'decision.text sa zmenil pri zápise');
    }

    public function test_node_description_round_trips_ampersand_and_tags(): void
    {
        $desc = 'Google Docs zahodí blok <style> s CSS. Pozri <head> & inline styly.';

        $this->callTool('mind_learn', [
            'label' => 'Escaping sonda',
            'type' => 'skill',
            'description' => $desc,
            'area' => 'Vývoj / kód',
        ]);

        $stored = Node::where('label', 'Escaping sonda')->first();
        $this->assertNotNull($stored, 'uzol sa nevytvoril');
        $this->assertSame($desc, $stored->description, 'node.description sa zmenil pri zápise');
    }

    public function test_department_name_round_trips_ampersand(): void
    {
        $this->callTool('mind_learn', [
            'label' => 'Sonda dept',
            'type' => 'skill',
            'description' => 'nieco',
            'area' => 'Vývoj / kód',
            'department' => 'Reporting & dataviz',
        ]);

        $stored = Node::where('label', 'Sonda dept')->first();
        $this->assertNotNull($stored);
        $this->assertSame('Reporting & dataviz', $stored->department?->name, 'department.name sa zmenil pri zápise');
    }

    /**
     * Jadro chyby: escapovaný názov sa nespáril s existujúcim oddelením,
     * spadol na fallback a založil duplikát „Reporting &amp; dataviz".
     */
    public function test_escaped_department_name_reuses_existing_department(): void
    {
        $area = Area::where('slug', 'vyvoj-kod')->firstOrFail();
        $dept = $area->departments()->create(['name' => 'Reporting & dataviz', 'slug' => 'reporting-dataviz']);

        $this->callTool('mind_learn', [
            'label' => 'Sonda escaped dept',
            'type' => 'skill',
            'description' => 'nieco',
            'area' => 'Vývoj / kód',
            'department' => 'Reporting &amp; dataviz',
        ]);

        $stored = Node::where('label', 'Sonda escaped dept')->first();
        $this->assertSame($dept->id, $stored->department_id, 'escapovaný názov založil duplicitné oddelenie');
        $this->assertSame(1, $area->departments()->count(), 'pribudlo duplicitné oddelenie');
    }

    /** Ak oddelenie ešte neexistuje, vznikne s obyčajným `&`, nie s entitou. */
    public function test_new_department_from_escaped_name_stores_raw_ampersand(): void
    {
        $this->callTool('mind_learn', [
            'label' => 'Sonda novy dept',
            'type' => 'skill',
            'description' => 'nieco',
            'area' => 'Vývoj / kód',
            'department' => 'Procesy &amp; prevádzka',
        ]);

        $stored = Node::where('label', 'Sonda novy dept')->first();
        $this->assertSame('Procesy & prevádzka', $stored->department?->name);
        $this->assertSame('procesy-prevadzka', $stored->department?->slug);
    }

    /** Escapovaný názov oblasti nesmie spadnúť na fallback area_id 1. */
    public function test_escaped_area_name_resolves_to_the_right_area(): void
    {
        $marketing = Area::create(['name' => 'Marketing & SEO', 'slug' => 'marketing-seo', 'color' => '#a33', 'angle' => 90]);
        $osobne = Area::create(['name' => 'Osobné & preferencie', 'slug' => 'osobne-preferencie', 'color' => '#3a3', 'angle' => 180]);

        $this->callTool('mind_learn', [
            'label' => 'Sonda escaped area',
            'type' => 'memory',
            'description' => 'nieco',
            'area' => 'Osobné &amp; preferencie',
        ]);

        $stored = Node::where('label', 'Sonda escaped area')->first();
        $this->assertSame($osobne->id, $stored->area_id, 'escapovaná oblasť spadla na fallback namiesto správnej');
        $this->assertNotSame($marketing->id, $stored->area_id);
    }

    /** Poistka: entity v obsahu sú niekedy legitímne a nesmú sa dekódovať. */
    public function test_entities_in_content_are_preserved_verbatim(): void
    {
        $desc = 'Kanonicky je „Reporting & dataviz", NIE variant s &amp; ani holé „Reporting".';

        $this->callTool('mind_learn', [
            'label' => 'Pasca: znecistene nazvy',
            'type' => 'skill',
            'description' => $desc,
            'area' => 'Vývoj / kód',
        ]);

        $this->assertSame($desc, Node::where('label', 'Pasca: znecistene nazvy')->first()->description);
    }
}
