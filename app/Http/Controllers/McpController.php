<?php

namespace App\Http\Controllers;

use App\Models\Area;
use App\Models\Decision;
use App\Models\Node;
use App\Services\Brain\SecretScanner;
use App\Services\MindService;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Str;
use Throwable;

/**
 * Streamable HTTP MCP server (JSON-RPC 2.0, stateless).
 * Vystavuje vedomie Hades ako MCP nastroje pre Claude Code.
 */
class McpController extends Controller
{
    protected const PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18'];

    public function __construct(
        protected SecretScanner $secrets = new SecretScanner,
    ) {}

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
                            'description' => 'Target area name — one of the areas returned by mind_overview',
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
                        'certainty' => [
                            'type' => 'string',
                            'enum' => ['overene', 'hypoteza', 'pasca'],
                            'description' => 'Confidence level: overene = verified/proven, '
                                .'hypoteza = hypothesis to confirm, pasca = pitfall/gotcha to avoid',
                        ],
                        'tags' => [
                            'type' => 'array',
                            'items' => ['type' => 'string'],
                            'description' => 'Free-form tags (many-to-many) to categorise the node',
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
                        'session_key' => $sessionKey,
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
            [
                'name' => 'mind_decision',
                'description' => 'Record a decision on the mind\'s timeline: a choice made and (optionally) '
                    .'why. Stored as a session decision (origin=session) — works regardless of the '
                    .'brain-write guard. Use Slovak for the decision text. Never store secrets.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'text' => ['type' => 'string', 'description' => 'What was decided (one to three sentences)'],
                        'reason' => ['type' => 'string', 'description' => 'Why — the rationale behind the decision'],
                        'area' => [
                            'type' => 'string',
                            'description' => 'Target area name — one of the areas returned by mind_overview',
                        ],
                        'decided_on' => [
                            'type' => 'string',
                            'description' => 'Decision date (YYYY-MM-DD); defaults to today when omitted',
                        ],
                    ],
                    'required' => ['text'],
                ],
            ],
            [
                'name' => 'mind_rename',
                'description' => 'Rename an existing node. Use it to fix a bad label — a raw user '
                    .'sentence, a markdown heading, a truncated title, or a name written without '
                    .'Slovak diacritics. Renaming is reversible and keeps all edges and history.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'label' => ['type' => 'string', 'description' => 'Current label of the node'],
                        'new_label' => ['type' => 'string', 'description' => 'Corrected label, short and human, no markdown'],
                        'type' => ['type' => 'string', 'enum' => ['skill', 'memory', 'project']],
                    ],
                    'required' => ['label', 'new_label'],
                ],
            ],
            [
                'name' => 'mind_move',
                'description' => 'Move a node to a different area and department. Both must already '
                    .'exist — call mind_overview first and pick from what it returns. Unknown names '
                    .'are rejected on purpose, so nodes cannot silently pile up in the wrong area.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'label' => ['type' => 'string', 'description' => 'Label of the node to move'],
                        'area' => ['type' => 'string', 'description' => 'Target area name from mind_overview'],
                        'department' => [
                            'type' => 'string',
                            'description' => 'Target department within that area; omit to clear the department',
                        ],
                        'type' => ['type' => 'string', 'enum' => ['skill', 'memory', 'project']],
                    ],
                    'required' => ['label', 'area'],
                ],
            ],
            [
                'name' => 'mind_delete',
                'description' => 'Reversibly delete a node that should never have been written — a raw '
                    .'prompt stored as a node, an empty stub, or one node per daily run. The node is '
                    .'soft-deleted: it disappears from recall and the graph but stays restorable, and '
                    .'a tombstone stops the next ingest from recreating it. Never delete knowledge '
                    .'that is merely outdated — rename or update it instead.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'label' => ['type' => 'string', 'description' => 'Label of the node to delete'],
                        'reason' => [
                            'type' => 'string',
                            'description' => 'Short reason, e.g. raw-prompt, stub, duplicate',
                        ],
                        'type' => ['type' => 'string', 'enum' => ['skill', 'memory', 'project']],
                    ],
                    'required' => ['label'],
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
                'mind_overview' => $this->toolOverview($mind),
                'mind_decision' => $this->toolDecision($args),
                'mind_rename' => $this->toolRename($args, $mind),
                'mind_move' => $this->toolMove($args, $mind),
                'mind_delete' => $this->toolDelete($args, $mind),
                default => throw new \InvalidArgumentException("Unknown tool: {$name}"),
            };
        } catch (Throwable $e) {
            report($e);

            return [
                'content' => [['type' => 'text', 'text' => 'Error: '.$e->getMessage()]],
                'isError' => true,
            ];
        }

        // hotová MCP odpoveď (napr. odmietnutie blacklistom) — pošli bez obalu
        if (isset($data['isError'], $data['content'])) {
            return $data;
        }

        // A9: bez JSON_PRETTY_PRINT. Payload je JSON vnorený v JSON stringe, takže
        // odsadenie a nové riadky sa ešte raz escapujú — pri recalle to bola takmer
        // tretina odpovede. Číta to výhradne stroj, komu odsadenie nič nedá, a
        // v LLM klientovi je každý znak navyše zaplatený token.
        // JSON_UNESCAPED_SLASHES navyše zbaví výstup `\/` v každej ceste a URL.
        return [
            'content' => [[
                'type' => 'text',
                'text' => json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
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

        $label = (string) $args['label'];
        $description = isset($args['description']) ? (string) $args['description'] : null;

        // serverová poistka blacklistu — heslá/kľúče/tokeny sa nikdy neukladajú
        if ($this->looksLikeSecret($label) || ($description !== null && $this->looksLikeSecret($description))) {
            return [
                'content' => [[
                    'type' => 'text',
                    'text' => 'Odmietnuté: obsah vyzerá ako heslo/API kľúč/token — tie do vedomia nepatria (pravidlo blacklistu).',
                ]],
                'isError' => true,
            ];
        }

        return $mind->learn(
            type: (string) $args['type'],
            label: $label,
            description: $description,
            areaName: (string) $args['area'],
            departmentName: isset($args['department']) ? (string) $args['department'] : null,
            connections: array_values((array) ($args['connections'] ?? [])),
            sessionKey: isset($args['session_key']) ? (string) $args['session_key'] : null,
            certainty: isset($args['certainty']) && $args['certainty'] !== '' ? (string) $args['certainty'] : null,
            tags: array_values(array_filter(array_map(
                fn ($t) => trim((string) $t),
                (array) ($args['tags'] ?? []),
            ), fn (string $t): bool => $t !== '')),
        );
    }

    /**
     * Heuristika na heslá, API kľúče a tokeny — nič z toho do vedomia nepatrí.
     * Deleguje na {@see SecretScanner} (jediný zdroj pravdy pre detekciu tajomstiev,
     * zdieľaný s brain-write). Vracia len áno/nie, nikdy matched hodnotu.
     */
    protected function looksLikeSecret(string $text): bool
    {
        return $this->secrets->looksLikeSecret($text);
    }

    protected function toolRecall(array $args, MindService $mind): array
    {
        if (blank($args['query'] ?? null)) {
            throw new \InvalidArgumentException('Missing required argument: query');
        }

        $nodes = $mind->recall(
            (string) $args['query'],
            max(1, min((int) ($args['limit'] ?? 12), 30)),
            isset($args['session_key']) ? (string) $args['session_key'] : null,
        );

        // A9: bez eager-loadu si každý uzol ťahal tagy vlastným dotazom (N+1,
        // pri limite 30 a susedoch až 45 dotazov navyše na jeden recall).
        $nodes = EloquentCollection::make($nodes->all());
        $nodes->load('tags');

        // A9: popisy sa už neposielajú celé. Rástli bez stropu (najväčší uzol
        // 25 389 B) a jeden recall na širokú tému vracal 77 493 znakov, z toho
        // 80 % boli popisy a tri uzly zabrali polovicu. Prvé uzly sú aj tie
        // najrelevantnejšie, tak dostanú väčší strop než zvyšok.
        $topChars = (int) config('hades.recall_desc_top_chars', 1200);
        $restChars = (int) config('hades.recall_desc_chars', 300);
        $topCount = (int) config('hades.recall_desc_top_count', 3);

        return [
            'found' => $nodes->count(),
            'nodes' => $nodes->values()->map(function (Node $node, int $i) use ($topChars, $restChars, $topCount) {
                $full = (string) $node->description;
                $short = Str::limit($full, $i < $topCount ? $topChars : $restChars);

                return [
                    'label' => $node->label,
                    'type' => $node->type,
                    'area' => $node->area?->name,
                    'department' => $node->department?->name,
                    'strength' => (float) $node->strength,
                    'certainty' => $node->certainty,
                    'tags' => $node->tags->pluck('name')->all(),
                    'verified' => $node->verified_at !== null,
                    'origin' => $node->origin,
                    'description' => $short,
                    // klient vie, že za týmto uzlom je ešte text — vie si ho
                    // dotiahnuť cielene cez mind_recall na konkrétnejší dopyt
                    'description_truncated' => $short !== $full,
                ];
            })->all(),
        ];
    }

    /**
     * Spoločné presné vyhľadanie uzla pre rename/move/delete. Nejednoznačný
     * label skončí chybou — pri týchto operáciách je „skoro ten správny uzol"
     * horší výsledok než odmietnutie.
     */
    protected function requireNode(array $args, MindService $mind): Node
    {
        if (blank($args['label'] ?? null)) {
            throw new \InvalidArgumentException('Missing required argument: label');
        }

        $node = $mind->findExact(
            (string) $args['label'],
            isset($args['type']) ? (string) $args['type'] : null,
        );

        if (! $node) {
            throw new \InvalidArgumentException(
                'No single node matches label: '.$args['label']
                .'. Use mind_recall to find its exact label first.'
            );
        }

        return $node;
    }

    protected function toolRename(array $args, MindService $mind): array
    {
        $node = $this->requireNode($args, $mind);

        if (blank($args['new_label'] ?? null)) {
            throw new \InvalidArgumentException('Missing required argument: new_label');
        }

        $before = $node->label;
        $node = $mind->rename($node, (string) $args['new_label']);

        return ['action' => 'renamed', 'from' => $before, 'node' => $node->toApi()];
    }

    protected function toolMove(array $args, MindService $mind): array
    {
        $node = $this->requireNode($args, $mind);

        if (blank($args['area'] ?? null)) {
            throw new \InvalidArgumentException('Missing required argument: area');
        }

        $before = [
            'area' => $node->area?->name,
            'department' => $node->department?->name,
        ];

        $node = $mind->move(
            $node,
            (string) $args['area'],
            isset($args['department']) ? (string) $args['department'] : null,
        );

        return ['action' => 'moved', 'from' => $before, 'node' => $node->toApi()];
    }

    protected function toolDelete(array $args, MindService $mind): array
    {
        $node = $this->requireNode($args, $mind);

        $label = $node->label;
        $mind->softDelete($node, (string) ($args['reason'] ?? 'deleted'));

        return [
            'action' => 'deleted',
            'label' => $label,
            'reversible' => true,
            'note' => 'Soft-deleted: hidden from recall and the graph, edges kept, restorable.',
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

    /**
     * Štruktúra vedomia + počet uzlov čakajúcich na kontrolu (needs_review),
     * aby Claude vedel, koľko brain-indexed poznatkov treba ešte overiť.
     */
    protected function toolOverview(MindService $mind): array
    {
        $data = $mind->overview();
        $data['totals']['needs_review'] = (int) Node::where('needs_review', true)->count();

        return $data;
    }

    /**
     * Zaznamená rozhodnutie do časovej osi ako DB záznam origin=session. Funguje
     * bez ohľadu na brain-write guard (§4.7). Markdown zrkadlo sa z MCP NEpíše —
     * na to slúži REST DecisionController pri guard ON.
     */
    protected function toolDecision(array $args): array
    {
        if (blank($args['text'] ?? null)) {
            throw new \InvalidArgumentException('Missing required argument: text');
        }

        $text = trim((string) $args['text']);
        $reason = isset($args['reason']) && trim((string) $args['reason']) !== ''
            ? trim((string) $args['reason'])
            : null;

        // serverová poistka blacklistu — rozhodnutie nesmie niesť heslo/kľúč/token
        if ($this->looksLikeSecret($text) || ($reason !== null && $this->looksLikeSecret($reason))) {
            return [
                'content' => [[
                    'type' => 'text',
                    'text' => 'Odmietnuté: rozhodnutie vyzerá ako heslo/API kľúč/token — to do vedomia nepatrí (pravidlo blacklistu).',
                ]],
                'isError' => true,
            ];
        }

        $decidedOn = ! empty($args['decided_on']) ? (string) $args['decided_on'] : now()->toDateString();
        $areaId = ! empty($args['area']) ? $this->resolveAreaId((string) $args['area']) : null;

        $decision = Decision::create([
            'area_id' => $areaId,
            'decided_on' => $decidedOn,
            'text' => $text,
            'reason' => $reason,
            'origin' => 'session',
        ]);

        return ['action' => 'decided', 'decision' => $decision->toApi()];
    }

    /** Oblasť podľa id (numerické) alebo slug/mena → area_id alebo null. */
    protected function resolveAreaId(string $area): ?int
    {
        if (ctype_digit($area)) {
            return Area::whereKey((int) $area)->value('id');
        }

        return Area::where('slug', Str::slug($area))
            ->orWhereRaw('LOWER(name) = ?', [mb_strtolower(trim($area))])
            ->value('id');
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
