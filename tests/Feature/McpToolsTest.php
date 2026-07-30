<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Decision;
use App\Models\Node;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * MCP JSON-RPC nástroje: kanonické `aura_*` (rozhodnutie #6) so schémou B5 —
 * `aura_learn` +certainty/tags, `aura_recall` vracia certainty/tags/verified/
 * origin, `aura_overview` +needs_review count, `aura_decision` (DB
 * origin=session, funguje aj pri guard OFF).
 *
 * Legacy `mind_*` aliasy pokrýva {@see McpSecurityTest}; endpoint je od W2 za
 * tokenom, preto každý request nesie Bearer hlavičku.
 */
class McpToolsTest extends TestCase
{
    use RefreshDatabase;

    /** Fiktívny token — nikdy sa nečíta z .env. */
    private const TOKEN = 'test-mcp-token-0123456789';

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'auraai.allow_brain_write' => false,
            'cache.default' => 'array',
            'mcp.token' => self::TOKEN,
        ]);

        Area::create(['name' => 'Vývoj / kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0]);
    }

    /** JSON-RPC POST na /mcp s platným tokenom. */
    private function rpc(string $method, array $params = [], int $id = 1): TestResponse
    {
        return $this->withHeader('Authorization', 'Bearer '.self::TOKEN)
            ->postJson('/mcp', [
                'jsonrpc' => '2.0',
                'id' => $id,
                'method' => $method,
                'params' => $params,
            ]);
    }

    /** Zavolá tool a vráti dekódovaný JSON payload z result.content[0].text. */
    private function callTool(string $tool, array $args = []): array
    {
        $res = $this->rpc('tools/call', ['name' => $tool, 'arguments' => $args])->assertOk();

        $text = $res->json('result.content.0.text');
        $this->assertIsString($text, "tool {$tool} musí vrátiť text content");

        return json_decode($text, true);
    }

    // ---- tools/list: kanonická sada + schéma B5 -----------------------------

    public function test_tools_list_exposes_certainty_tags_and_aura_decision(): void
    {
        $tools = $this->rpc('tools/list')->assertOk()->json('result.tools');

        $names = collect($tools)->pluck('name')->all();
        $this->assertContains('aura_decision', $names);

        $learn = collect($tools)->firstWhere('name', 'aura_learn');
        $props = $learn['inputSchema']['properties'];
        $this->assertArrayHasKey('certainty', $props);
        $this->assertArrayHasKey('tags', $props);
        $this->assertSame(['overene', 'hypoteza', 'pasca'], $props['certainty']['enum']);
    }

    // ---- aura_learn s certainty/tags ---------------------------------------

    public function test_learn_stores_certainty_and_tags(): void
    {
        $data = $this->callTool('aura_learn', [
            'type' => 'skill',
            'label' => 'Kubernetes Ingress',
            'description' => 'Smerovanie HTTP do klastra cez ingress controller.',
            'area' => 'vyvoj-kod',
            'certainty' => 'overene',
            'tags' => ['k8s', 'network'],
        ]);

        $this->assertContains($data['action'], ['created', 'merged']);
        $this->assertSame('overene', $data['node']['certainty']);
        $this->assertEqualsCanonicalizing(['k8s', 'network'], $data['node']['tags']);

        $node = Node::where('label', 'Kubernetes Ingress')->first();
        $this->assertNotNull($node);
        $this->assertSame('overene', $node->certainty);
        $this->assertEqualsCanonicalizing(['k8s', 'network'], $node->tags()->pluck('name')->all());
    }

    public function test_learn_without_new_params_still_works(): void
    {
        // regres — holý aura_learn (bez certainty/tags) beží nezmenene
        $data = $this->callTool('aura_learn', [
            'type' => 'memory',
            'label' => 'Fakt bez značiek',
            'area' => 'vyvoj-kod',
        ]);

        $this->assertContains($data['action'], ['created', 'merged']);
        $this->assertNull($data['node']['certainty']);
        $this->assertSame([], $data['node']['tags']);
    }

    /**
     * `certainty` mimo enumu je od W2 validačná chyba, nie tichý zápis. Predtým
     * sa akákoľvek hodnota poslala do MindService a skončila v DB, hoci schéma
     * povoľuje tri.
     */
    public function test_learn_rejects_certainty_outside_enum(): void
    {
        $res = $this->rpc('tools/call', ['name' => 'aura_learn', 'arguments' => [
            'type' => 'skill',
            'label' => 'Uzol s nezmyslom',
            'area' => 'vyvoj-kod',
            'certainty' => 'vymyslene',
        ]])->assertOk();

        $this->assertTrue($res->json('result.isError'));
        $this->assertNull(Node::where('label', 'Uzol s nezmyslom')->first());
    }

    /** Blacklist ostáva serverovou poistkou — a nikdy nevráti zachytenú hodnotu. */
    public function test_learn_rejects_content_that_looks_like_a_secret(): void
    {
        $res = $this->rpc('tools/call', ['name' => 'aura_learn', 'arguments' => [
            'type' => 'memory',
            'label' => 'Prihlásenie do stagingu',
            'description' => 'password: nejakeDlheHeslo123',
            'area' => 'vyvoj-kod',
        ]])->assertOk();

        $this->assertTrue($res->json('result.isError'));
        $text = (string) $res->json('result.content.0.text');
        $this->assertStringContainsString('blacklistu', $text);
        $this->assertStringNotContainsString('nejakeDlheHeslo123', $text);
        $this->assertNull(Node::where('label', 'Prihlásenie do stagingu')->first());
    }

    // ---- aura_recall vracia certainty/tags/verified/origin ------------------

    public function test_recall_returns_certainty_tags_verified_origin(): void
    {
        $this->callTool('aura_learn', [
            'type' => 'skill',
            'label' => 'Redis caching',
            'description' => 'Cache-aside vzor s TTL a jitterom v Redise.',
            'area' => 'vyvoj-kod',
            'certainty' => 'hypoteza',
            'tags' => ['redis'],
        ]);

        $data = $this->callTool('aura_recall', ['query' => 'Redis caching']);

        $this->assertGreaterThanOrEqual(1, $data['found']);
        $hit = collect($data['nodes'])->firstWhere('label', 'Redis caching');
        $this->assertNotNull($hit);
        $this->assertSame('hypoteza', $hit['certainty']);
        $this->assertContains('redis', $hit['tags']);
        $this->assertFalse($hit['verified']);
        $this->assertArrayHasKey('origin', $hit);
    }

    /** `limit` sa zovrie do 1..30 — strop je ochrana pred vyčerpaním kontextu. */
    public function test_recall_clamps_limit(): void
    {
        $data = $this->callTool('aura_recall', ['query' => 'Redis caching', 'limit' => 9999]);

        $this->assertLessThanOrEqual(30, count($data['nodes']));
    }

    // ---- aura_overview +needs_review ---------------------------------------

    public function test_overview_includes_needs_review_count(): void
    {
        $areaId = Area::where('slug', 'vyvoj-kod')->value('id');
        Node::create(['type' => 'memory', 'origin' => 'brain', 'area_id' => $areaId, 'label' => 'X', 'strength' => 1, 'needs_review' => true, 'last_activated_at' => now()]);
        Node::create(['type' => 'memory', 'origin' => 'brain', 'area_id' => $areaId, 'label' => 'Y', 'strength' => 1, 'needs_review' => false, 'last_activated_at' => now()]);

        $data = $this->callTool('aura_overview');

        $this->assertArrayHasKey('needs_review', $data['totals']);
        $this->assertSame(1, $data['totals']['needs_review']);
    }

    // ---- aura_decision (DB origin=session, guard OFF) ----------------------

    public function test_decision_creates_session_db_row_with_guard_off(): void
    {
        $data = $this->callTool('aura_decision', [
            'text' => 'Zvolili sme Reverb pre WebSockety.',
            'reason' => 'Natívna Laravel integrácia.',
            'area' => 'vyvoj-kod',
            'decided_on' => '2026-07-19',
        ]);

        $this->assertSame('decided', $data['action']);
        $this->assertSame('session', $data['decision']['origin']);
        $this->assertSame('2026-07-19', $data['decision']['decided_on']);

        $this->assertSame(1, Decision::where('origin', 'session')->count());
        $decision = Decision::first();
        $this->assertSame('Zvolili sme Reverb pre WebSockety.', $decision->text);
        $this->assertNotNull($decision->area_id);
    }

    public function test_decision_requires_text(): void
    {
        $res = $this->rpc('tools/call', ['name' => 'aura_decision', 'arguments' => ['reason' => 'x']])
            ->assertOk();

        $this->assertTrue($res->json('result.isError'));
    }
}
