<?php

namespace App\Mcp;

use App\Mcp\Exceptions\ToolValidationException;
use Throwable;

/**
 * MCP server (JSON-RPC 2.0, stateless) — protokolová vrstva bez HTTP.
 *
 * Vyčlenená z 455-riadkového McpControlleru: controller je odteraz len HTTP
 * adaptér (telo → správy → odpoveď), tento server rieši protokol a
 * {@see ToolRegistry} rieši tooly.
 *
 * Log hygiena: validačné chyby ({@see ToolValidationException}) sa NEreportujú.
 * 87 zo 102 „chýb" v laravel.log bolo presne toto — chýbajúci argument toolu
 * skončil ako `report($e)` v error logu. Do error logu ide len skutočná porucha.
 */
class McpServer
{
    /** Verzie protokolu, ktoré server prijme pri `initialize`. */
    public const PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18'];

    public const LATEST_PROTOCOL_VERSION = '2025-06-18';

    public function __construct(private readonly ToolRegistry $registry) {}

    /**
     * Spracuje jednu JSON-RPC správu. Vracia odpoveď, alebo null pri notifikácii
     * (na tú sa podľa špecifikácie neodpovedá).
     */
    public function handle(array $message): ?array
    {
        $method = $message['method'] ?? null;
        $id = $message['id'] ?? null;
        $params = (array) ($message['params'] ?? []);
        $isNotification = ! array_key_exists('id', $message);

        try {
            $result = match ($method) {
                'initialize' => $this->initialize($params),
                'ping' => (object) [],
                'tools/list' => ['tools' => $this->registry->definitions()],
                'tools/call' => $this->callTool($params),
                'notifications/initialized', 'notifications/cancelled' => null,
                default => $isNotification
                    ? null
                    : $this->error($id, -32601, "Method not found: {$method}"),
            };
        } catch (ToolValidationException $e) {
            // chybný vstup klienta — odpoveď protokolu, nie porucha servera
            return $isNotification ? null : $this->error($id, -32602, $e->getMessage());
        } catch (Throwable $e) {
            report($e);

            return $isNotification ? null : $this->error($id, -32603, $e->getMessage());
        }

        if ($isNotification || $result === null) {
            return null;
        }

        // `is_array` guard je oprava zdedeného bugu: `ping` vracia prázdny objekt
        // (`(object) []`, aby sa serializoval ako `{}` a nie `[]`) a pôvodné
        // `isset($result['jsonrpc'])` nad stdClass zhodilo požiadavku fatálnou
        // chybou „Cannot use object of type stdClass as array" → `ping` vracal 500.
        if (is_array($result) && isset($result['jsonrpc'])) {
            return $result;
        }

        return ['jsonrpc' => '2.0', 'id' => $id, 'result' => $result];
    }

    /** Handshake — identita servera a inštrukcie pre model. */
    public function initialize(array $params): array
    {
        $requested = $params['protocolVersion'] ?? self::LATEST_PROTOCOL_VERSION;

        return [
            'protocolVersion' => in_array($requested, self::PROTOCOL_VERSIONS, true)
                ? $requested
                : self::LATEST_PROTOCOL_VERSION,
            'capabilities' => ['tools' => (object) []],
            'serverInfo' => [
                'name' => 'auraai',
                'title' => 'AuraAI — living memory',
                'version' => '1.0.0',
            ],
            'instructions' => 'AuraAI is the user\'s persistent AI mind — a living neural network of '
                .'skills, memories and projects learned across Claude Code sessions. Call aura_recall '
                .'at the start of a session to remember relevant context. Call aura_learn whenever you '
                .'learn something significant (a new skill demonstrated, an important fact about the '
                .'user, a new project). Call aura_activate when an already-known skill is used again. '
                .'Never store passwords, API keys, financial or health data. The mind_* tools are '
                .'deprecated aliases of the aura_* tools and will be removed.',
        ];
    }

    /**
     * `tools/call` — nájde tool (kanonicky aj cez legacy alias) a obalí výsledok.
     * Tool smie vrátiť aj hotovú MCP odpoveď (odmietnutie blacklistom).
     */
    protected function callTool(array $params): array
    {
        $name = (string) ($params['name'] ?? '');
        $args = (array) ($params['arguments'] ?? []);

        try {
            $data = $this->registry->get($name)->handle($args);
        } catch (ToolValidationException $e) {
            // validačná chyba nejde do error logu — je to bežná odpoveď protokolu
            return $this->toolError($e->getMessage());
        } catch (Throwable $e) {
            report($e);

            return $this->toolError($e->getMessage());
        }

        // hotová MCP odpoveď (napr. odmietnutie blacklistom) — pošli bez obalu
        if (isset($data['isError'], $data['content'])) {
            return $data;
        }

        return [
            'content' => [[
                'type' => 'text',
                'text' => json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT),
            ]],
            'isError' => false,
        ];
    }

    protected function toolError(string $message): array
    {
        return [
            'content' => [['type' => 'text', 'text' => 'Error: '.$message]],
            'isError' => true,
        ];
    }

    public function error(mixed $id, int $code, string $message): array
    {
        return [
            'jsonrpc' => '2.0',
            'id' => $id,
            'error' => ['code' => $code, 'message' => $message],
        ];
    }
}
