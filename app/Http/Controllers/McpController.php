<?php

namespace App\Http\Controllers;

use App\Models\Area;
use App\Models\Decision;
use App\Models\Edge;
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

        // `is_array` musí byť prvé: `ping` vracia (object) [] a `isset($obj['k'])`
        // na stdClass je v PHP 8 fatálna chyba, takže každý ping padal na 500.
        if (is_array($result) && isset($result['jsonrpc'])) {
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
                    .'A near-identical node is merged; a merely similar one is queued for human '
                    .'review instead of being merged, and the response reports how many such '
                    .'duplicate_candidates it raised. Use Slovak for personal facts and projects, '
                    .'English for technical skill names. Only store significant knowledge, never '
                    .'secrets (passwords, API keys, financial/health data).',
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
                    .'their projects or preferences would help. How to read the answer: `relevance` is '
                    .'0-1, the share of query concepts a node matched; a node with `via` is NOT a direct '
                    .'hit — the graph pulled it in through that neighbour, at half relevance. `related` '
                    .'names the strongest connections of each node, so you get structure, not a flat list. '
                    .'Empty fields are omitted to save context: no `origin` means session, no `verified` '
                    .'means unverified, no `tags`/`department`/`certainty` means none. `description` is '
                    .'shortened (lower-ranked hits get the snippet around the match); when '
                    .'`description_truncated` is true, read the whole node with mind_read. `noise` marks '
                    .'a low-quality node (raw-prompt = a raw user sentence stored as a label, markdown = '
                    .'markdown left in the label, slug = machine-generated name, stub = no description) — '
                    .'do not trust it as a source, and consider fixing it with mind_rename or dropping '
                    .'it with mind_delete.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'query' => ['type' => 'string', 'description' => 'Topic or keywords to remember about'],
                        'areas' => [
                            'type' => 'array',
                            'items' => ['type' => 'string'],
                            'description' => 'Restrict the search to these areas (names from mind_overview). '
                                .'Omit to search the whole mind.',
                        ],
                        'limit' => ['type' => 'integer', 'description' => 'Max nodes to return (default 12)'],
                        'session_key' => $sessionKey,
                    ],
                    'required' => ['query'],
                ],
            ],
            [
                'name' => 'mind_read',
                'description' => 'Read one node in full: the complete description (mind_recall shortens '
                    .'it), every tag, the source .md path if the knowledge came from a file, and the '
                    .'strongest connections. Use it when mind_recall returned `description_truncated` '
                    .'or when a `related`/`via` label looks worth opening. Identify the node by its '
                    .'exact `label` from mind_recall, or by `id`.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'label' => ['type' => 'string', 'description' => 'Exact label of the node, as returned by mind_recall'],
                        'id' => ['type' => 'integer', 'description' => 'Node id — use instead of label when you have it'],
                        'type' => ['type' => 'string', 'enum' => ['skill', 'memory', 'project']],
                    ],
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
                'mind_read' => $this->toolRead($args, $mind),
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

        $query = (string) $args['query'];

        $recall = $mind->recallWithMeta(
            $query,
            max(1, min((int) ($args['limit'] ?? 12), 30)),
            isset($args['session_key']) ? (string) $args['session_key'] : null,
            // rozsah sa uplatní už v SQL — zúžiť výsledok až po prijatí by
            // ušetrilo šum, ale nie payload, a ten je pri lokálnom modeli cena
            isset($args['areas']) ? array_values(array_filter((array) $args['areas'], 'is_string')) : null,
        );

        // A9: bez eager-loadu si každý uzol ťahal tagy vlastným dotazom (N+1,
        // pri limite 30 a susedoch až 45 dotazov navyše na jeden recall).
        $nodes = EloquentCollection::make($recall['nodes']->all());
        $nodes->load('tags');
        $meta = $recall['meta'];

        // A9: popisy sa už neposielajú celé. Rástli bez stropu (najväčší uzol
        // 25 389 B) a jeden recall na širokú tému vracal 77 493 znakov, z toho
        // 80 % boli popisy a tri uzly zabrali polovicu. Prvé uzly sú aj tie
        // najrelevantnejšie, tak dostanú väčší strop než zvyšok.
        $topChars = (int) config('hades.recall_desc_top_chars', 900);
        $restChars = (int) config('hades.recall_desc_chars', 300);
        $topCount = (int) config('hades.recall_desc_top_count', 3);
        // Sused má polovičnú relevanciu, nech má aj polovičný strop — je to
        // kontext, nie odpoveď.
        $neighborChars = (int) config('hades.recall_desc_neighbor_chars', 200);
        $tagCap = max(0, (int) config('hades.recall_tag_cap', 8));

        // Korene dopytu — podľa nich sa vyberá, KTORÉ tagy sa zmestia do stropu.
        // Uzol s 38 tagmi platil 400 B za abecedu; teraz idú prvé tie, ktoré
        // s dopytom naozaj súvisia.
        $roots = $mind->queryRoots($query);

        $out = [
            'found' => $nodes->count(),
            // ako bol dopyt pochopený (stemované korene) — keď recall vráti
            // nezmysly, AI vidí prečo, namiesto hádania
            'terms' => $recall['terms'],
            'nodes' => $nodes->values()->map(function (Node $node, int $i) use (
                $meta, $topChars, $restChars, $topCount, $neighborChars, $tagCap, $roots, $mind
            ) {
                $m = $meta[$node->id] ?? [];
                $via = $m['via'] ?? null;
                $full = trim((string) $node->description);

                $cap = $via !== null
                    ? $neighborChars
                    : ($i < $topCount ? $topChars : $restChars);

                // Pod hranicou top uzlov je úryvok okolo zhody hodnotnejší než
                // slepý začiatok popisu — rovnaké tokeny, viac signálu. Doteraz
                // ho searchNodes počítal a recall zahadzoval.
                //
                // Len keď sa popis do stropu NEZMESTÍ. Inak by úryvok orezal
                // začiatok textu, ktorý by sa bol vošiel celý — presne to sa
                // stalo uzlu „Hades (AI-mind)": popis má 135 znakov, strop 300,
                // a odpoveď aj tak začínala trojbodkou v polovici vety.
                $text = $full;
                if ($via === null && $i >= $topCount && ! empty($m['snippet']) && mb_strlen($full) > $cap) {
                    $text = (string) $m['snippet'];
                }
                $text = (string) Str::limit($text, $cap);

                $row = [
                    'label' => $node->label,
                    'type' => $node->type,
                    'area' => $node->area?->name,
                    'department' => $node->department?->name,
                    'relevance' => $m['relevance'] ?? null,
                    'via' => $via,
                    'strength' => (float) $node->strength,
                    'certainty' => $node->certainty,
                    'tags' => $this->rankTags($node->tags->pluck('name')->all(), $roots, $tagCap, $mind),
                    'verified' => $node->verified_at !== null,
                    // `session` je pôvod 95 % uzlov a teda default; vypisovať ho
                    // na každom uzle je 20 B za nulovú informáciu
                    'origin' => $node->origin === 'session' ? null : $node->origin,
                    'noise' => $m['noise'] ?? null,
                    // Uzol, ktorý dopyt trafil VÝZNAMOM, nie slovom (vektorová vetva).
                    // AI to potrebuje vedieť: pri semantickom zásahu nemá v uzle
                    // hľadať slová z dopytu, lebo tam nie sú. Prázdne sa neposiela.
                    'semantic' => $m['semantic'] ?? null,
                    'related' => $m['related'] ?? [],
                    'description' => $text,
                    // klient vie, že za týmto uzlom je ešte text — dotiahne si ho
                    // celý cez mind_read
                    'description_truncated' => $text !== $full,
                ];

                return $this->dropEmpty($row);
            })->all(),
        ];

        if ($out['found'] === 0) {
            $out['hint'] = 'Nothing matched. Try other words (the query is stemmed — see `terms`), '
                .'drop the `areas` scope, or call mind_overview to see what the mind holds.';
        }

        return $out;
    }

    /**
     * Prečíta jeden uzol celý — protiváha ku skracovaniu v recalle.
     *
     * `description_truncated: true` doteraz hlásilo, že za uzlom je ešte text,
     * ale AI ho nemala ako dostať: recall na presnejší dopyt vracia ten istý
     * skrátený popis. Toto je tá chýbajúca cesta.
     */
    protected function toolRead(array $args, MindService $mind): array
    {
        $node = null;

        if (! blank($args['id'] ?? null) && ctype_digit((string) $args['id'])) {
            $node = Node::query()->with(['area', 'department', 'tags'])->find((int) $args['id']);
        }

        if (! $node) {
            if (blank($args['label'] ?? null)) {
                throw new \InvalidArgumentException('Missing required argument: label (or id)');
            }

            // rovnaká tvrdá identifikácia ako pri rename/move/delete —
            // „skoro ten správny uzol" je pri čítaní rovnako zlá odpoveď
            $node = $this->requireNode($args, $mind);
            $node->load(['area', 'department', 'tags']);
        }

        $cap = max(1, (int) config('hades.read_related_cap', 20));

        $edges = Edge::query()
            ->where('source_id', $node->id)
            ->orWhere('target_id', $node->id)
            ->orderByDesc('weight')
            ->get(['source_id', 'target_id']);

        $relatedIds = $edges
            ->map(fn (Edge $e) => (int) $e->source_id === (int) $node->id ? $e->target_id : $e->source_id)
            ->unique()
            ->values();

        // labely jedným dotazom, v poradí podľa váhy hrany
        $labels = $relatedIds->isEmpty()
            ? collect()
            : Node::whereIn('id', $relatedIds->take($cap)->all())->pluck('label', 'id');

        $related = $relatedIds->take($cap)
            ->map(fn ($id) => $labels[$id] ?? null)
            ->filter()
            ->values()
            ->all();

        return $this->dropEmpty([
            'label' => $node->label,
            'type' => $node->type,
            'area' => $node->area?->name,
            'department' => $node->department?->name,
            'strength' => (float) $node->strength,
            'certainty' => $node->certainty,
            'origin' => $node->origin,
            'verified' => $node->verified_at !== null,
            'needs_review' => (bool) $node->needs_review,
            'noise' => $mind->noiseOf($node),
            'tags' => $node->tags->pluck('name')->all(),
            'source' => $mind->sourcePathOf($node),
            'created' => $node->created_at?->toDateString(),
            'last_activated' => $node->last_activated_at?->toDateString(),
            // celý popis, bez stropu — o to tu ide
            'description' => trim((string) $node->description),
            'related' => $related,
            'related_total' => $relatedIds->count(),
        ]);
    }

    /**
     * Vyhodí polia, ktoré nenesú informáciu (`null`, `false`, `''`, `[]`).
     *
     * Na každom uzle recallu sedelo `certainty: null`, `department: null`,
     * `tags: []`, `verified: false` — namerané 2 052 B z 38 362 B (5,3 %)
     * zaplatených za prázdno. Nula a `0.0` ostávajú: nula je hodnota.
     * Význam vynechania je v popise nástroja, aby si ho AI nemusela domýšľať.
     *
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    protected function dropEmpty(array $row): array
    {
        return array_filter(
            $row,
            fn ($value) => $value !== null && $value !== false && $value !== '' && $value !== [],
        );
    }

    /**
     * Tagy do stropu: najprv tie, ktoré trafil dopyt, potom ostatné.
     *
     * @param  array<int, string>  $tags
     * @param  \Illuminate\Support\Collection<int, string>  $roots
     * @return array<int, string>
     */
    protected function rankTags(array $tags, $roots, int $cap, MindService $mind): array
    {
        if ($cap <= 0 || count($tags) <= $cap) {
            return $tags;
        }

        $hit = [];
        $rest = [];
        foreach ($tags as $tag) {
            $folded = $mind->fold($tag);
            $matches = $roots->contains(fn (string $root) => mb_strpos($folded, $root) !== false);
            if ($matches) {
                $hit[] = $tag;
            } else {
                $rest[] = $tag;
            }
        }

        return array_slice(array_merge($hit, $rest), 0, $cap);
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

        // Neznáma oblasť sa TICHO nezahadzuje. Predtým sa rozhodnutie uložilo
        // s area_id = null a odpoveď vyzerala rovnako úspešne, takže volajúci
        // nemal ako zistiť, že o zaradenie prišel — dva takto osirené záznamy
        // (id 40 a 46) vznikli tým, že v názve prišlo „&amp;" namiesto „&"
        // a slug potom nesedel. Chyba menuje platné oblasti, aby AI vedela
        // dopyt opraviť namiesto hádania.
        $areaId = null;
        if (! empty($args['area'])) {
            $areaId = $this->resolveAreaId((string) $args['area']);
            if ($areaId === null) {
                throw new \InvalidArgumentException(
                    'Unknown area: '.trim((string) $args['area'])
                    .'. Known areas: '.Area::orderBy('id')->pluck('name')->implode(', ')
                );
            }
        }

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
