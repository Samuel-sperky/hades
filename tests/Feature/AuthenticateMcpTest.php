<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Guard nad /mcp (A1, 12.8.2026).
 *
 * Predtým bol /mcp úplne bez autentifikácie — chránil ho len binding na
 * 127.0.0.1:8080, čo nechráni pred ničím, čo beží na tom istom stroji.
 *
 * Query varianta `?token=` je zámerná a musí zostať: connectory appky Claude
 * (mobil/desktop) nevedia poslať vlastnú Authorization hlavičku, len URL.
 */
class AuthenticateMcpTest extends TestCase
{
    use RefreshDatabase;

    private const TOKEN = 'test-mcp-token';

    protected function setUp(): void
    {
        parent::setUp();

        config(['hades.mcp_token' => self::TOKEN, 'cache.default' => 'array']);
    }

    /** Minimálny platný JSON-RPC dotaz — stačí na overenie, či guard pustil ďalej. */
    private function ping(array $headers = [], string $query = ''): TestResponse
    {
        return $this->withHeaders($headers)->postJson('/mcp'.$query, [
            'jsonrpc' => '2.0',
            'id' => 1,
            'method' => 'tools/list',
        ]);
    }

    public function test_request_without_any_token_is_rejected(): void
    {
        $this->ping()->assertStatus(401);
    }

    public function test_request_with_wrong_bearer_token_is_rejected(): void
    {
        $this->ping(['Authorization' => 'Bearer nespravny-token'])->assertStatus(401);
    }

    public function test_request_with_wrong_query_token_is_rejected(): void
    {
        $this->ping([], '?token=nespravny-token')->assertStatus(401);
    }

    public function test_bearer_token_is_accepted(): void
    {
        $this->ping(['Authorization' => 'Bearer '.self::TOKEN])->assertOk();
    }

    public function test_query_token_is_accepted_for_claude_connectors(): void
    {
        $this->ping([], '?token='.self::TOKEN)->assertOk();
    }

    public function test_bearer_scheme_is_case_insensitive(): void
    {
        $this->ping(['Authorization' => 'bearer '.self::TOKEN])->assertOk();
    }

    public function test_guard_is_fail_closed_when_token_is_not_configured(): void
    {
        config(['hades.mcp_token' => '']);

        // ani správne vyzerajúci token neprejde, keď server žiadny nemá
        $this->ping(['Authorization' => 'Bearer '.self::TOKEN])->assertStatus(401);
        $this->ping()->assertStatus(401);
    }

    public function test_guard_covers_get_and_delete_too(): void
    {
        $this->getJson('/mcp')->assertStatus(401);
        $this->deleteJson('/mcp')->assertStatus(401);

        // s tokenom guard pustí ďalej a odpovie už samotný controller
        // (GET je Streamable HTTP zámerne 405, DELETE 204)
        $this->getJson('/mcp?token='.self::TOKEN)->assertStatus(405);
        $this->deleteJson('/mcp?token='.self::TOKEN)->assertStatus(204);
    }
}
