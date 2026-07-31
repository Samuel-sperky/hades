<?php

namespace Tests\Feature;

use App\Mcp\ToolRegistry;
use App\Models\Area;
use App\Models\Node;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

/**
 * Bezpečnostná brána pre `/mcp` (rozhodnutie #21) a rename toolov na `aura_*`
 * so skrytými `mind_*` aliasmi (rozhodnutie #6).
 *
 * Do W2 bol `/mcp` bez autentifikácie a bez throttle — pri zapnutom ngrok tuneli
 * teda verejný ZÁPISOVÝ endpoint do dlhodobej pamäte (`aura_learn`,
 * `aura_decision`). Tento test je poistka, aby sa to nedalo omylom vrátiť.
 */
class McpSecurityTest extends TestCase
{
    use RefreshDatabase;

    /** Fiktívne tokeny — nikdy sa nečítajú z .env. */
    private const TOKEN = 'test-mcp-token-0123456789';

    private const WRONG_TOKEN = 'test-mcp-token-9876543210';

    protected function setUp(): void
    {
        parent::setUp();

        config(['cache.default' => 'array', 'mcp.token' => self::TOKEN]);

        Area::create(['name' => 'Vývoj / kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0]);
    }

    private function body(string $method = 'ping', array $params = []): array
    {
        return ['jsonrpc' => '2.0', 'id' => 1, 'method' => $method, 'params' => $params];
    }

    // ---- auth ---------------------------------------------------------------

    public function test_rejects_request_without_token(): void
    {
        $this->postJson('/mcp', $this->body())
            ->assertStatus(401)
            ->assertJsonPath('error.code', -32001);
    }

    public function test_rejects_wrong_token(): void
    {
        $this->withHeader('Authorization', 'Bearer '.self::WRONG_TOKEN)
            ->postJson('/mcp', $this->body())
            ->assertStatus(401);
    }

    public function test_accepts_bearer_token(): void
    {
        $this->withHeader('Authorization', 'Bearer '.self::TOKEN)
            ->postJson('/mcp', $this->body())
            ->assertOk()
            ->assertJsonPath('id', 1);
    }

    /**
     * Konektory v appke Claude vedia poslať len URL, žiadnu hlavičku — bez query
     * varianty by sa k pamäti nedostali.
     */
    public function test_accepts_query_token(): void
    {
        $this->postJson('/mcp?token='.self::TOKEN, $this->body())->assertOk();
    }

    public function test_query_token_can_be_disabled(): void
    {
        config(['mcp.allow_query_token' => false]);

        $this->postJson('/mcp?token='.self::TOKEN, $this->body())->assertStatus(401);

        // hlavička funguje ďalej
        $this->withHeader('Authorization', 'Bearer '.self::TOKEN)
            ->postJson('/mcp', $this->body())->assertOk();
    }

    /** Fail-closed: prázdny token v configu = neprejde nikto, ani s hlavičkou. */
    public function test_is_fail_closed_when_no_token_configured(): void
    {
        config(['mcp.token' => '']);

        $this->postJson('/mcp', $this->body())->assertStatus(401);

        $this->withHeader('Authorization', 'Bearer '.self::TOKEN)
            ->postJson('/mcp', $this->body())->assertStatus(401);
    }

    /** GET je Allow: POST, DELETE — ale až za tokenom. */
    public function test_get_requires_token_too(): void
    {
        $this->get('/mcp')->assertStatus(401);

        $this->withHeader('Authorization', 'Bearer '.self::TOKEN)
            ->get('/mcp')->assertStatus(405);
    }

    // ---- throttle -----------------------------------------------------------

    public function test_response_carries_rate_limit_headers(): void
    {
        $first = $this->withHeader('Authorization', 'Bearer '.self::TOKEN)
            ->postJson('/mcp', $this->body())->assertOk();

        [$limit] = explode(',', (string) config('mcp.throttle', '120,1'));

        $first->assertHeader('X-RateLimit-Limit', $limit);
        $this->assertSame(
            (int) $limit - 1,
            (int) $first->headers->get('X-RateLimit-Remaining'),
            'throttle musí odpočítavať — bez toho endpoint limit reálne nemá',
        );
    }

    /**
     * Throttle je PRED auth, takže flood pokusov o token sa počíta a endpoint sa
     * nedá zavaliť hádaním tokenu.
     */
    public function test_throttle_counts_unauthenticated_attempts(): void
    {
        $this->postJson('/mcp', $this->body())->assertStatus(401);

        $second = $this->postJson('/mcp', $this->body())->assertStatus(401);

        // druhý pokus už videl limiter (prvý ho inkrementoval)
        $this->assertNotNull($second->headers->get('X-RateLimit-Remaining'));
        [$limit] = explode(',', (string) config('mcp.throttle', '120,1'));
        $this->assertLessThan(
            (int) $limit,
            (int) $second->headers->get('X-RateLimit-Remaining'),
        );
    }

    /**
     * Limit musí platiť aj pre `tools/call`, nie len pre „lacné" metódy — inak by
     * bol strop na endpointe, ale zápis do pamäte (`aura_learn`) bez stropu.
     * Po vyčerpaní limitu dostane volanie toolu 429 a NIČ sa nezapíše.
     */
    public function test_throttle_covers_tool_calls_not_just_the_endpoint(): void
    {
        [$limit] = explode(',', (string) config('mcp.throttle', '120,1'));

        for ($i = 0; $i < (int) $limit; $i++) {
            $this->withHeader('Authorization', 'Bearer '.self::TOKEN)
                ->postJson('/mcp', $this->body())->assertOk();
        }

        $before = Node::count();

        $this->withHeader('Authorization', 'Bearer '.self::TOKEN)
            ->postJson('/mcp', $this->body('tools/call', [
                'name' => 'aura_learn',
                'arguments' => ['type' => 'skill', 'label' => 'nad limitom', 'area' => 'Vývoj / kód'],
            ]))
            ->assertStatus(429);

        $this->assertSame($before, Node::count(), 'zápis nad limitom sa nesmie vykonať');
    }

    // ---- identita servera + rename toolov -----------------------------------

    public function test_initialize_reports_auraai_identity(): void
    {
        $res = $this->withHeader('Authorization', 'Bearer '.self::TOKEN)
            ->postJson('/mcp', $this->body('initialize'))->assertOk();

        $res->assertJsonPath('result.serverInfo.name', 'auraai');
        $res->assertJsonPath('result.serverInfo.title', 'AuraAI — living memory');
        $this->assertStringContainsString('aura_recall', (string) $res->json('result.instructions'));
    }

    public function test_tools_list_has_canonical_aura_tools_and_legacy_aliases(): void
    {
        $names = collect($this->tools())->pluck('name')->all();

        $canonical = ['aura_learn', 'aura_recall', 'aura_activate', 'aura_overview', 'aura_decision'];
        foreach ($canonical as $tool) {
            $this->assertContains($tool, $names);
        }

        // legacy aliasy sú počas prechodu prítomné, ale označené
        foreach (['mind_learn', 'mind_recall', 'mind_activate', 'mind_overview', 'mind_decision'] as $alias) {
            $this->assertContains($alias, $names);
        }

        $legacy = collect($this->tools())->firstWhere('name', 'mind_recall');
        $this->assertStringContainsString('legacy alias of aura_recall', $legacy['description']);

        // kanonické idú prvé, aby model volil aura_*
        $this->assertSame($canonical, array_slice($names, 0, 5));
    }

    public function test_legacy_aliases_can_be_switched_off(): void
    {
        config(['mcp.legacy_aliases' => false]);

        $names = collect($this->tools())->pluck('name')->all();

        $this->assertContains('aura_recall', $names);
        $this->assertNotContains('mind_recall', $names);
    }

    /** Alias musí ísť na TEN ISTÝ handler — inak Claude Code stratí pamäť. */
    public function test_legacy_alias_dispatches_to_the_same_handler(): void
    {
        $viaAlias = $this->callTool('mind_overview');
        $viaCanonical = $this->callTool('aura_overview');

        $this->assertFalse($viaAlias['isError']);
        $this->assertSame(
            array_keys($viaCanonical['data']),
            array_keys($viaAlias['data']),
        );
        $this->assertSame($viaCanonical['data']['totals'], $viaAlias['data']['totals']);
    }

    /**
     * Alias nesmie byť zadné vrátka okolo blacklistu: `mind_learn` je ten istý
     * handler, takže secret guard platí rovnako ako pre `aura_learn`.
     */
    public function test_legacy_alias_enforces_the_secret_guard(): void
    {
        $before = Node::count();

        foreach (['aura_learn', 'mind_learn'] as $tool) {
            $res = $this->callTool($tool, [
                'type' => 'memory',
                'label' => 'test guard',
                'area' => 'Vývoj / kód',
                'description' => 'api_key=sk-ant-FAKE0000000000000000000000000000TEST',
            ]);

            $this->assertTrue($res['isError'], "{$tool} musí odmietnuť obsah, ktorý vyzerá ako secret");
        }

        $this->assertSame($before, Node::count());
    }

    public function test_registry_maps_every_canonical_tool_to_an_alias(): void
    {
        $registry = app(ToolRegistry::class);

        foreach (array_keys($registry->tools()) as $canonical) {
            $alias = 'mind_'.substr($canonical, strlen('aura_'));
            $this->assertSame(
                $canonical,
                $registry->resolve($alias),
                "alias {$alias} musí ukazovať na {$canonical}",
            );
        }
    }

    public function test_unknown_tool_is_an_error_not_a_crash(): void
    {
        $res = $this->withHeader('Authorization', 'Bearer '.self::TOKEN)
            ->postJson('/mcp', $this->body('tools/call', ['name' => 'aura_nonexistent']))
            ->assertOk();

        $this->assertTrue($res->json('result.isError'));
        $this->assertStringContainsString('Unknown tool', (string) $res->json('result.content.0.text'));
    }

    // ---- e-shop tooly za flagom --------------------------------------------

    /**
     * `aura_shop_*` sa nesmú objaviť, kým service vrstvu nedodá jej balík — ani
     * keď je flag zapnutý. Inak by `tools/list` inzeroval tool, ktorý spadne.
     */
    public function test_shop_tools_stay_hidden_without_the_service_layer(): void
    {
        config(['mcp.shop_tools' => true]);

        $names = collect($this->tools())->pluck('name')->all();

        if (class_exists(\App\Mcp\Tools\ShopOrdersTool::CLIENT)) {
            $this->assertContains('aura_shop_orders', $names);
            $this->assertContains('aura_shop_products', $names);

            return;
        }

        $this->assertNotContains('aura_shop_orders', $names);
        $this->assertNotContains('aura_shop_products', $names);
    }

    // ---- protokol -----------------------------------------------------------

    /**
     * Regres: `ping` vracal 500. `(object) []` prechádzalo cez
     * `isset($result['jsonrpc'])`, čo je nad stdClass fatálna chyba
     * („Cannot use object of type stdClass as array").
     */
    public function test_ping_returns_empty_object_not_500(): void
    {
        $res = $this->withHeader('Authorization', 'Bearer '.self::TOKEN)
            ->postJson('/mcp', $this->body('ping'))->assertOk();

        $this->assertSame([], $res->json('result'));
    }

    public function test_notification_gets_no_body(): void
    {
        $this->withHeader('Authorization', 'Bearer '.self::TOKEN)
            ->postJson('/mcp', ['jsonrpc' => '2.0', 'method' => 'notifications/initialized'])
            ->assertStatus(202);
    }

    public function test_malformed_body_is_parse_error(): void
    {
        $this->call(
            'POST',
            '/mcp',
            [],
            [],
            [],
            ['HTTP_AUTHORIZATION' => 'Bearer '.self::TOKEN, 'CONTENT_TYPE' => 'application/json'],
            'not json at all',
        )->assertOk()->assertJsonPath('error.code', -32700);
    }

    // ---- log hygiena --------------------------------------------------------

    /**
     * Rozhodnutie #38: 87 zo 102 „chýb" v laravel.log bolo `report($e)` nad
     * validačnými výnimkami z MCP. Chýbajúci argument toolu je odpoveď
     * protokolu, nie porucha servera, a do error logu nepatrí.
     */
    public function test_tool_validation_error_is_not_logged_as_error(): void
    {
        Log::spy();

        $res = $this->withHeader('Authorization', 'Bearer '.self::TOKEN)
            ->postJson('/mcp', $this->body('tools/call', [
                'name' => 'aura_learn',
                'arguments' => ['type' => 'skill'],   // chýba label aj area
            ]))->assertOk();

        // klient chybu dostane…
        $this->assertTrue($res->json('result.isError'));
        $this->assertStringContainsString('label', (string) $res->json('result.content.0.text'));

        // …ale do error logu nepadne
        Log::shouldNotHaveReceived('error');
        Log::shouldNotHaveReceived('critical');
    }

    // ---- helpers ------------------------------------------------------------

    /** @return list<array{name: string, description: string, inputSchema: array}> */
    private function tools(): array
    {
        return $this->withHeader('Authorization', 'Bearer '.self::TOKEN)
            ->postJson('/mcp', $this->body('tools/list'))
            ->assertOk()
            ->json('result.tools');
    }

    /** @return array{isError: bool, data: array} */
    private function callTool(string $tool, array $args = []): array
    {
        $res = $this->withHeader('Authorization', 'Bearer '.self::TOKEN)
            ->postJson('/mcp', $this->body('tools/call', ['name' => $tool, 'arguments' => $args]))
            ->assertOk();

        return [
            'isError' => (bool) $res->json('result.isError'),
            'data' => (array) json_decode((string) $res->json('result.content.0.text'), true),
        ];
    }
}
