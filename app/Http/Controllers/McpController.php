<?php

namespace App\Http\Controllers;

use App\Services\MindService;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Throwable;

/**
 * Streamable HTTP MCP server (JSON-RPC 2.0, stateless).
 * Vystavuje vedomie Hades ako MCP nastroje pre Claude Code.
 */
class McpController extends Controller
{
    protected const PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18'];

    public function __invoke(Request $request, MindService $mind): Response
    {
        if ($request->isMethod('get')) {
            return response('', 405, ['Allow' => 'POST, DELETE']);
        }

        if ($request->isMethod('delete')) {
            return response('', 204);
        }

        $payload = json_decode($request->getContent(), true);

        if (! is_array($payload)) {
            return $this->json($this->error(null, -32700, 'Parse error'));
        }

        $isBatch = array_is_list($payload);
        $messages = $isBatch ? $payload : [$payload];

        $responses = [];
        foreach ($messages as $message) {
            $response = $this->handle(is_array($message) ? $message : [], $mind);
            if ($response !== null) {
                $responses[] = $response;
            }
        }

        if ($responses === []) {
            return response('', 202);
        }

        return $this->json($isBatch ? $responses : $responses[0]);
    }

    protected function handle(array $message, MindService $mind): ?array
    {
        $method = $message['method'] ?? null;
        $id = $message['id'] ?? null;
        $params = (array) ($message['params'] ?? []);
        $isNotification = ! array_key_exists('id', $message);

        try {
            $result = match ($method) {
                'initialize' => $this->initialize($params),
                'ping' => (object) [],
                'tools/list' => ['tools' => $this->toolDefinitions()],
                'tools/call' => $this->callTool($params, $mind),
                'notifications/initialized', 'notifications/cancelled' => null,
                default => $isNotification
                    ? null
                    : $this->error($id, -32601, "Method not found: {$method}"),
            };
        } catch (Throwable $e) {
            report($e);

            return $isNotification ? null : $this->error($id, -32603, $e->getMessage());
        }

        if ($isNotification || $result === null) {
            return null;
        }

        if (isset($result['jsonrpc'])) {
            return $result;
        }

        return ['jsonrpc' => '2.0', 'id' => $id, 'result' => $result];
    }

    protected function initialize(array $params): array
    {
        $requested = $params['protocolVersion'] ?? '2025-06-18';

        return [
            'protocolVersion' => in_array($requested, self::PROTOCOL_VERSIONS, true)
                ? $requested
                : '2025-06-18',
            'capabilities' => ['tools' => (object) []],
            'serverInfo' => [
                'name' => 'hades',
                'title' => 'Hades — AI mind',
                'version' => '1.0.0',
            ],
            'instructions' => 'Hades is the user\'s persistent AI mind — a living neural network of '
                .'skills, memories and projects learned across Claude Code sessions. Call mind_recall '
                .'at the start of a session to remember relevant context. Call mind_learn whenever you '
                .'learn something significant (a new skill demonstrated, an important fact about the '
                .'user, a new project). Call mind_activate when an already-known skill is used again. '
                .'Never store passwords, API keys, financial or health data.',
        ];
    }

    protected function toolDefinitions(): array
    {
        $sessionKey = [
            'type' => 'string',
            'description' => 'Current session identifier (any stable string for this conversation). '
                .'Nodes touched in the same session get auto-connected.',
        ];

        return [
            [
                'name' => 'mind_learn',
                'description' => 'Store a significant new piece of knowledge in the mind: a skill the '
                    .'assistant demonstrated, an important fact/memory about the user, or a project. '
                    .'Duplicates are merged automatically — call it freely. Use Slovak for personal '
                    .'facts and projects, English for technical skill names. Only store significant '
                    .'knowledge, never secrets (passwords, API keys, financial/health data).',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'type' => [
                            'type' => 'string',
                            'enum' => ['skill', 'memory', 'project'],
                            'description' => 'skill = a capability; memory = a fact about the user or world; project = ongoing work',
                        ],
                        'label' => ['type' => 'string', 'description' => 'Short node name, max ~5 words'],
                        'description' => ['type' => 'string', 'description' => 'One to three sentences of detail'],
                        'area' => [
                            'type' => 'string',
                            'description' => 'Target area name. Prefer one from mind_overview; a new area is created automatically if it clearly does not fit any existing one.',
                        ],
                        'department' => [
                            'type' => 'string',
                            'description' => 'Sub-department within the area; created automatically if new',
                        ],
                        'connections' => [
                            'type' => 'array',
                            'items' => ['type' => 'string'],
                            'description' => 'Labels of related existing nodes to connect to',
                        ],
                        'source' => [
                            'type' => 'string',
                            'description' => 'Where this knowledge came from — project/repo name or path. Optional but useful for provenance.',
                        ],
                        'session_key' => $sessionKey,
                    ],
                    'required' => ['type', 'label', 'area'],
                ],
            ],
            [
                'name' => 'mind_recall',
                'description' => 'Search the mind for knowledge relevant to a topic. Call at the start '
                    .'of a session with the session topic, and any time earlier context about the user, '
                    .'their projects or preferences would help.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'query' => ['type' => 'string', 'description' => 'Topic or keywords to remember about'],
                        'limit' => ['type' => 'integer', 'description' => 'Max nodes to return (default 12)'],
                    ],
                    'required' => ['query'],
                ],
            ],
            [
                'name' => 'mind_activate',
                'description' => 'Strengthen an existing node when its skill/knowledge is actually used '
                    .'again. If the node does not exist yet, use mind_learn instead.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'label' => ['type' => 'string', 'description' => 'Label of the node being used'],
                        'type' => ['type' => 'string', 'enum' => ['skill', 'memory', 'project']],
                        'session_key' => $sessionKey,
                    ],
                    'required' => ['label'],
                ],
            ],
            [
                'name' => 'mind_overview',
                'description' => 'Get the current structure of the mind: areas, their departments and '
                    .'node counts. Use it to pick the right area/department before mind_learn.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => (object) [],
                ],
            ],
        ];
    }

    protected function callTool(array $params, MindService $mind): array
    {
        $name = $params['name'] ?? '';
        $args = (array) ($params['arguments'] ?? []);

        try {
            $data = match ($name) {
                'mind_learn' => $this->toolLearn($args, $mind),
                'mind_recall' => $this->toolRecall($args, $mind),
                'mind_activate' => $this->toolActivate($args, $mind),
                'mind_overview' => $mind->overview(),
                default => throw new \InvalidArgumentException("Unknown tool: {$name}"),
            };
        } catch (Throwable $e) {
            report($e);

            return [
                'content' => [['type' => 'text', 'text' => 'Error: '.$e->getMessage()]],
                'isError' => true,
            ];
        }

        return [
            'content' => [[
                'type' => 'text',
                'text' => json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT),
            ]],
            'isError' => false,
        ];
    }

    protected function toolLearn(array $args, MindService $mind): array
    {
        foreach (['type', 'label', 'area'] as $required) {
            if (blank($args[$required] ?? null)) {
                throw new \InvalidArgumentException("Missing required argument: {$required}");
            }
        }

        return $mind->learn(
            type: (string) $args['type'],
            label: (string) $args['label'],
            description: isset($args['description']) ? (string) $args['description'] : null,
            areaName: (string) $args['area'],
            departmentName: isset($args['department']) ? (string) $args['department'] : null,
            connections: array_values((array) ($args['connections'] ?? [])),
            sessionKey: isset($args['session_key']) ? (string) $args['session_key'] : null,
            source: isset($args['source']) ? (string) $args['source'] : null,
        );
    }

    protected function toolRecall(array $args, MindService $mind): array
    {
        if (blank($args['query'] ?? null)) {
            throw new \InvalidArgumentException('Missing required argument: query');
        }

        $nodes = $mind->recall(
            (string) $args['query'],
            max(1, min((int) ($args['limit'] ?? 12), 30)),
        );

        return [
            'found' => $nodes->count(),
            'nodes' => $nodes->map(fn ($node) => [
                'label' => $node->label,
                'type' => $node->type,
                'area' => $node->area?->name,
                'department' => $node->department?->name,
                'strength' => (float) $node->strength,
                'description' => $node->description,
            ])->all(),
        ];
    }

    protected function toolActivate(array $args, MindService $mind): array
    {
        if (blank($args['label'] ?? null)) {
            throw new \InvalidArgumentException('Missing required argument: label');
        }

        $node = $mind->activate(
            (string) $args['label'],
            isset($args['type']) ? (string) $args['type'] : null,
            isset($args['session_key']) ? (string) $args['session_key'] : null,
        );

        if (! $node) {
            return [
                'action' => 'not_found',
                'hint' => 'Node does not exist yet — store it with mind_learn.',
            ];
        }

        return ['action' => 'activated', 'node' => $node];
    }

    protected function error(mixed $id, int $code, string $message): array
    {
        return [
            'jsonrpc' => '2.0',
            'id' => $id,
            'error' => ['code' => $code, 'message' => $message],
        ];
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
