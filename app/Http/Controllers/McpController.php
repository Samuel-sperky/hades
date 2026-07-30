<?php

namespace App\Http\Controllers;

use App\Mcp\McpServer;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * HTTP adaptér pre MCP server (Streamable HTTP, JSON-RPC 2.0, stateless).
 *
 * Controller rieši LEN transport: metódu, telo, batch a hlavičky. Protokol žije
 * v {@see McpServer}, tooly v {@see \App\Mcp\ToolRegistry}. Predtým to bolo
 * 455 riadkov v jednom controlleri.
 *
 * Autentifikácia a throttle sú middleware (`auth.mcp` + `throttle`) nastavené
 * v `bootstrap/app.php` — endpoint je zápisový vstup do dlhodobej pamäte a
 * appka sa tuneluje verejne, takže bez tokenu neprejde nikto.
 */
class McpController extends Controller
{
    public function __construct(private readonly McpServer $server) {}

    public function __invoke(Request $request): Response
    {
        if ($request->isMethod('get')) {
            return response('', 405, ['Allow' => 'POST, DELETE']);
        }

        if ($request->isMethod('delete')) {
            return response('', 204);
        }

        $payload = json_decode($request->getContent(), true);

        if (! is_array($payload)) {
            return $this->json($this->server->error(null, -32700, 'Parse error'));
        }

        $isBatch = array_is_list($payload);
        $messages = $isBatch ? $payload : [$payload];

        $responses = [];
        foreach ($messages as $message) {
            $response = $this->server->handle(is_array($message) ? $message : []);
            if ($response !== null) {
                $responses[] = $response;
            }
        }

        // len notifikácie → podľa špecifikácie sa neodpovedá telom
        if ($responses === []) {
            return response('', 202);
        }

        return $this->json($isBatch ? $responses : $responses[0]);
    }

    protected function json(array $body): Response
    {
        return response(
            json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            200,
            ['Content-Type' => 'application/json'],
        );
    }
}
