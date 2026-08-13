<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Decision;
use App\Models\Node;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * MCP JSON-RPC nástroje (B5): mind_learn +certainty/tags, mind_recall vracia
 * certainty/tags/verified/origin, mind_overview +needs_review count, nový
 * mind_decision (DB origin=session, funguje aj pri guard OFF).
 */
class McpToolsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // /mcp je od 12.8.2026 za tokenom (AuthenticateMcp, fail-closed) —
        // bez neho by každý JSON-RPC dotaz nižšie skončil na 401.
        config([
            'hades.allow_brain_write' => false,
            'hades.mcp_token' => 'test-mcp-token',
            'cache.default' => 'array',
        ]);

        Area::create(['name' => 'Vývoj / kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0]);
    }

    /** JSON-RPC POST na /mcp. */
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

    /** Zavolá tool a vráti dekódovaný JSON payload z result.content[0].text. */
    private function callTool(string $tool, array $args = []): array
    {
        $res = $this->rpc('tools/call', ['name' => $tool, 'arguments' => $args])->assertOk();

        $text = $res->json('result.content.0.text');
        $this->assertIsString($text, "tool {$tool} musí vrátiť text content");

        return json_decode($text, true);
    }

    // ---- ping: keepalive klientov -------------------------------------------

    /**
     * `ping` vracia prázdny objekt, nie pole — a `isset($result['jsonrpc'])` na
     * stdClass je v PHP 8 fatálna chyba, takže KAŽDÝ ping padal na HTTP 500.
     * Odhalilo sa to až pri stdio moste (bin/hades-mcp-stdio.mjs), lebo keepalive
     * posielajú klienti, nie testy.
     */
    public function test_ping_returns_empty_result_instead_of_500(): void
    {
        $this->rpc('ping', id: 9)
            ->assertOk()
            ->assertExactJson(['jsonrpc' => '2.0', 'id' => 9, 'result' => []]);
    }

    // ---- tools/list: nová schéma + nový tool -------------------------------

    public function test_tools_list_exposes_certainty_tags_and_mind_decision(): void
    {
        $tools = $this->rpc('tools/list')->assertOk()->json('result.tools');

        $names = collect($tools)->pluck('name')->all();
        $this->assertContains('mind_decision', $names);

        $learn = collect($tools)->firstWhere('name', 'mind_learn');
        $props = $learn['inputSchema']['properties'];
        $this->assertArrayHasKey('certainty', $props);
        $this->assertArrayHasKey('tags', $props);
        $this->assertSame(['overene', 'hypoteza', 'pasca'], $props['certainty']['enum']);
    }

    // ---- mind_learn s certainty/tags ---------------------------------------

    public function test_learn_stores_certainty_and_tags(): void
    {
        $data = $this->callTool('mind_learn', [
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
        // regres — holý mind_learn (bez certainty/tags) beží nezmenene
        $data = $this->callTool('mind_learn', [
            'type' => 'memory',
            'label' => 'Fakt bez značiek',
            'area' => 'vyvoj-kod',
        ]);

        $this->assertContains($data['action'], ['created', 'merged']);
        $this->assertNull($data['node']['certainty']);
        $this->assertSame([], $data['node']['tags']);
    }

    // ---- mind_recall vracia certainty/tags/verified/origin -----------------

    public function test_recall_returns_certainty_tags_verified_origin(): void
    {
        // MindService::searchNodes používa MariaDB-only `COLLATE utf8mb4_unicode_ci`
        // (accent-insensitive LIKE), ktoré sqlite nepozná → recall sa reálne overuje
        // proti MariaDB (viď curl smoke v správe). Na sqlite ho preskočíme.
        if (\Illuminate\Support\Facades\DB::connection()->getDriverName() === 'sqlite') {
            $this->markTestSkipped('recall/searchNodes vyžaduje MariaDB COLLATE (overené smoke proti MariaDB).');
        }

        $this->callTool('mind_learn', [
            'type' => 'skill',
            'label' => 'Redis caching',
            'description' => 'Cache-aside vzor s TTL a jitterom v Redise.',
            'area' => 'vyvoj-kod',
            'certainty' => 'hypoteza',
            'tags' => ['redis'],
        ]);

        $data = $this->callTool('mind_recall', ['query' => 'Redis caching']);

        $this->assertGreaterThanOrEqual(1, $data['found']);
        $hit = collect($data['nodes'])->firstWhere('label', 'Redis caching');
        $this->assertNotNull($hit);
        $this->assertSame('hypoteza', $hit['certainty']);
        $this->assertContains('redis', $hit['tags']);
        $this->assertFalse($hit['verified']);
        $this->assertArrayHasKey('origin', $hit);
    }

    // ---- mind_overview +needs_review ---------------------------------------

    public function test_overview_includes_needs_review_count(): void
    {
        $areaId = Area::where('slug', 'vyvoj-kod')->value('id');
        Node::create(['type' => 'memory', 'origin' => 'brain', 'area_id' => $areaId, 'label' => 'X', 'strength' => 1, 'needs_review' => true, 'last_activated_at' => now()]);
        Node::create(['type' => 'memory', 'origin' => 'brain', 'area_id' => $areaId, 'label' => 'Y', 'strength' => 1, 'needs_review' => false, 'last_activated_at' => now()]);

        $data = $this->callTool('mind_overview');

        $this->assertArrayHasKey('needs_review', $data['totals']);
        $this->assertSame(1, $data['totals']['needs_review']);
    }

    // ---- mind_decision (DB origin=session, guard OFF) ----------------------

    public function test_decision_creates_session_db_row_with_guard_off(): void
    {
        $data = $this->callTool('mind_decision', [
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
        $res = $this->rpc('tools/call', ['name' => 'mind_decision', 'arguments' => ['reason' => 'x']])
            ->assertOk();

        $this->assertTrue($res->json('result.isError'));
    }
}
