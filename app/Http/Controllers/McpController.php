<?php

namespace App\Http\Controllers;

use App\Events\MindPulse;
use App\Models\Area;
use App\Models\Decision;
use App\Models\Edge;
use App\Models\Node;
use App\Models\Run;
use App\Models\Tag;
use App\Serializers\Screen\DennikScreen;
use App\Serializers\Screen\DnesScreen;
use App\Serializers\Screen\ChatScreen;
use App\Serializers\Screen\HygienaScreen;
use App\Serializers\Screen\KniznicaScreen;
use App\Serializers\Screen\KontrolaScreen;
use App\Serializers\Screen\RozhodnutiaScreen;
use App\Serializers\Screen\RunDetailScreen;
use App\Serializers\Screen\RunsScreen;
use App\Serializers\Screen\SmernicaScreen;
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

    /**
     * Sémantické vzťahy, ktoré smie pomenovať `mind_link` — presne tie, ktoré už
     * v sieti žijú v stĺpci `edges.relation` (viď migráciu a MindRewire::backfillRelations).
     *
     * Vedľa toho stojí `edges.kind` (mechanizmus vzniku hrany: similarity,
     * co_activation, skill_mention, wiki, manual) a ten volajúci nastavovať NEMÔŽE:
     * ručné prepojenie z MCP JE `manual`, takže nechať AI napísať `similarity` by
     * znamenalo dovoliť jej sfalšovať pôvod hrany. Nové hodnoty sem nepridávaj bez
     * toho, aby ich vedel čítať aj MindRewire a graf — inak vzniknú relácie, ktoré
     * nikto nezobrazí.
     */
    protected const LINK_RELATIONS = ['uses', 'part_of'];

    /** `certainty` uzla — tá istá trojica, akú berie mind_learn. */
    protected const CERTAINTY = ['overene', 'hypoteza', 'pasca'];

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
                    .'hit — the graph pulled it in through that neighbour, at half relevance. `semantic` '
                    .'marks a node that matched by MEANING rather than by words, so the words of your '
                    .'query will NOT appear in it. `related` '
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
            [
                'name' => 'mind_update',
                'description' => 'Correct an existing node whose text is wrong or out of date: replaces '
                    .'its description, and optionally sets certainty or adds tags. This is the ONLY way '
                    .'to fix a description — mind_learn with the same label MERGES instead: it appends '
                    .'the new text UNDER the old one and bumps strength, so the node keeps opening with '
                    .'the wrong claim and carries the correction beneath it (worst of all on a `pasca` '
                    .'node, where the first sentence is the one that gets believed). The default is a '
                    .'full replace; pass mode=append only when the old text stays true and you are '
                    .'adding to it. `tags` are added to the ones the node already has, never removed; '
                    .'`certainty` overwrites. Identify the node by `id` when you have one, otherwise by '
                    .'its exact `label` from mind_recall. Not for renaming (mind_rename), not for '
                    .'refiling (mind_move), not for a genuinely new piece of knowledge (mind_learn). '
                    .'Never write secrets.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'id' => ['type' => 'integer', 'description' => 'Node id — preferred when you have it'],
                        'label' => ['type' => 'string', 'description' => 'Exact label of the node — use when you have no id'],
                        'description' => ['type' => 'string', 'description' => 'The corrected text'],
                        'mode' => [
                            'type' => 'string',
                            'enum' => ['replace', 'append'],
                            'description' => 'replace (default) = the new text becomes the whole description; '
                                .'append = the new text is added at the end, old text kept',
                        ],
                        'certainty' => [
                            'type' => 'string',
                            'enum' => ['overene', 'hypoteza', 'pasca'],
                            'description' => 'Overwrite the confidence level; omit to leave it as it is',
                        ],
                        'tags' => [
                            'type' => 'array',
                            'items' => ['type' => 'string'],
                            'description' => 'Tags to add (existing tags are kept)',
                        ],
                    ],
                    'required' => ['description'],
                ],
            ],
            [
                'name' => 'mind_link',
                'description' => 'Link two existing nodes on purpose, when you have just understood that '
                    .'they are related. Every other edge in the mind is made by machinery — same-session '
                    .'co-activation, label mentions, vector similarity — so this is the only way a '
                    .'deliberate insight becomes structure that later recalls can walk. The edge is '
                    .'undirected and recorded as `manual`, the strongest provenance in the mind, so no '
                    .'automatic pass can downgrade it. `relation` is optional and names what the '
                    .'relatedness IS, from the vocabulary the mind already uses: `uses` (one node uses '
                    .'the other) or `part_of` (one node is a member of the other); because the edge has '
                    .'no direction, `relation` labels the pair, not the way round. Identify each side by '
                    .'`from_id`/`to_id`, or by an exact label in `from`/`to`. Calling it again on the '
                    .'same pair is a no-op: the weight is not inflated and a relation already set is '
                    .'never overwritten. Self-links are refused. Do not use it to record that a skill '
                    .'was used again (that is mind_activate), and do not link everything to everything — '
                    .'an edge that carries no meaning costs every future recall.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'from_id' => ['type' => 'integer', 'description' => 'Id of the first node'],
                        'to_id' => ['type' => 'integer', 'description' => 'Id of the second node'],
                        'from' => ['type' => 'string', 'description' => 'Exact label of the first node — use when you have no id'],
                        'to' => ['type' => 'string', 'description' => 'Exact label of the second node — use when you have no id'],
                        'relation' => [
                            'type' => 'string',
                            'enum' => self::LINK_RELATIONS,
                            'description' => 'What the relatedness is: uses | part_of. Omit when neither fits — '
                                .'an unlabelled link is still a link.',
                        ],
                    ],
                ],
            ],
            [
                'name' => 'mind_hygiene',
                'description' => 'Read-only report on the junk in the mind: how many nodes fall into each '
                    .'defect class, plus a few example ids. Use it when the user asks how healthy the '
                    .'memory is, or before offering to tidy it up. Classes are ordered by `weight` — 5 '
                    .'means the class costs you the most on every recall, 1 that it only wastes a row: '
                    .'raw-prompt, markdown, tag-sprawl, duplicate, slug, oversized, misfiled, stub, '
                    .'orphan. `examples` are node ids; open one with mind_read to judge it. This tool '
                    .'changes nothing, and fixing is deliberately not exposed through MCP: rename with '
                    .'mind_rename, refile with mind_move, correct the text with mind_update, drop a '
                    .'genuinely worthless node with mind_delete, and leave duplicates to the human queue '
                    .'(`php artisan mind:duplicates`). It walks the whole network, so call it once per '
                    .'conversation, not per node.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'class' => [
                            'type' => 'string',
                            'description' => 'Report only this one class; an unknown class is refused and the '
                                .'error names the valid ones',
                        ],
                        'limit' => [
                            'type' => 'integer',
                            'description' => 'Example ids per class (default 3, max 10)',
                        ],
                    ],
                ],
            ],
            [
                'name' => 'mind_runs',
                'description' => 'List the console runs — what the local agent was asked to do and how it '
                    .'went. Use it when the user asks what the console has been doing, why a run stopped, '
                    .'or what a task cost; and use it before repeating work, because a failed run tells '
                    .'you what has already been tried. One row per turn, newest first. `status` is the '
                    .'whole story of a run: `done` finished, `failed` carries an `error`, `waiting` is '
                    .'parked on a write the human has not decided yet, `aborted` means the human walked '
                    .'away or the app restarted mid-turn, `running` is live right now. `stop_reason` says '
                    .'why generation ended — a run that hit the step cap is NOT a finished answer, it is '
                    .'a truncated one. `tokens_out` and `duration_ms` are the price: duration is wall '
                    .'clock and so includes the minutes a human spent deciding about a write, which is '
                    .'why it can dwarf the generation time. `tool_calls` of 0 means the model answered '
                    .'from context alone. Filters narrow the list server-side; `q` matches the prompt '
                    .'text — but `counts` always covers the WHOLE table and no filter ever narrows it, '
                    .'so do not read it as the shape of your filtered result. Read one run whole with '
                    .'mind_run. `parent` is the uuid of the run that spawned this one as a subagent '
                    .'(spawn_agent), so the list is a tree; pass it to mind_run to read the turn that '
                    .'delegated the work. Never add `duration_ms` up across a parent and its children — '
                    .'the parent stays open for the whole subagent, so the same waiting would be counted '
                    .'twice; `tokens_out` does add up. Empty fields are omitted: no `error` means the run '
                    .'did not fail, no `parent` means a human started this run, no `thread` means the run '
                    .'outlived the thread it ran in (threads can be deleted, runs are kept).',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'status' => [
                            'type' => 'string',
                            'enum' => ['running', 'waiting', 'done', 'aborted', 'failed'],
                            'description' => 'Only runs in this state',
                        ],
                        'model' => ['type' => 'string', 'description' => 'Only runs of this model, e.g. qwen3:8b'],
                        'thread' => ['type' => 'string', 'description' => 'Uuid of one console thread'],
                        'q' => ['type' => 'string', 'description' => 'Substring of the prompt'],
                        'since' => ['type' => 'string', 'description' => 'Only runs started at or after this date (YYYY-MM-DD)'],
                        'limit' => ['type' => 'integer', 'description' => 'Max rows (default 50, max 200)'],
                    ],
                ],
            ],
            [
                'name' => 'mind_run',
                'description' => 'Read one console run whole: its prompt, its cost, and the timeline of '
                    .'what actually happened, step by step. Identify it by the `uuid` from mind_runs. '
                    .'`timeline` is ordered as it happened and mixes two kinds of entry: `message` (a '
                    .'turn of the conversation, with `role` user or assistant) and `tool` (one tool call, '
                    .'with `name`, `arguments`, `status` and `result`). A tool `status` of `denied` is the '
                    .'most informative entry in the mind: it is a write the human refused, so do not '
                    .'propose the same write again without saying why it is different this time. '
                    .'`pending` is a write still waiting for a decision. The system directive is left out '
                    .'of the timeline on purpose — it is configuration, not a step, and it would swamp '
                    .'the answer. Long tool results are cut; the whole text lives in the thread. '
                    .'`children` are the subagents this run spawned, in the order it spawned them, each '
                    .'with its own `uuid` to read whole — their steps and tokens are NOT counted in this '
                    .'run, so a turn that delegated cost more than its own numbers say. Their '
                    .'`duration_ms` is not a slice of this one either: this run stayed open the whole '
                    .'time, waiting, so the two overlap and must not be added or subtracted. `parent` '
                    .'is the run that spawned this one; no `parent` means a human started it.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'uuid' => ['type' => 'string', 'description' => 'Uuid of the run, from mind_runs'],
                    ],
                    'required' => ['uuid'],
                ],
            ],
            [
                'name' => 'mind_today',
                'description' => "Read the mind's dashboard — the screen the human opens first. Use it at "
                    .'the start of a session to learn the shape of the memory before you search it, and '
                    .'when the user asks how big the mind is, what it has been doing lately, or what is '
                    .'waiting to be checked. Returns `counts` (nodes, edges, decisions, and the split of '
                    .'`brain` — playbook nodes backed by a .md file — versus `session`, learned in '
                    .'conversation), `certainty` (overene/hypoteza/pasca/bez plus `needs_review`, the '
                    .'queue only a human may clear — you cannot verify a node), `per_area` with that same '
                    .'split per area, which is the map of where knowledge actually sits, `week_added` for '
                    .'the last 7 days, `growth` (cumulative node count per month, oldest first), '
                    .'`recent_sessions` and `recent_records` (what was worked on last, newest first; pass '
                    .'`id` to mind_read), `top_projects`, and `sync` (last playbook sync). The year '
                    .'activity heatmap is left out on purpose: 365 cells are a picture, not a fact. '
                    .'`#bez-projektu` in a project field is not a project name — it is the group of '
                    .'sessions that ran in a temporary directory. In `sync`, `state` is `none` when sync '
                    .'never ran and `unknown` for a state this app does not know; trust `state`, not '
                    .'`status`. Empty fields are omitted: no `snippet` means the record has no '
                    .'description, no `message` means the sync run said nothing.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [],
                ],
            ],
            [
                'name' => 'mind_journal',
                'description' => "Read the mind's journal — the chronology of work, newest first. Use it "
                    .'when the answer depends on WHEN something happened or on what was done in one '
                    .'project: mind_recall finds knowledge but says nothing about order, so this is the '
                    .'only way to get a timeline. Use it also before starting work on a project, because '
                    .'the newest records say where the previous session stopped. Returns `records` (one '
                    .'per Claude Code session or weekly digest: `label`, `created_at`, `prompt_count`, '
                    .'`file_count`, `commit_count`, `project_key`), `project_groups` (every project with '
                    .'its record count over the WHOLE journal, largest first — these `key` values are '
                    .'exactly what `project` accepts), `total` and `filtered_total` (how many records the '
                    .'filter matched, which can exceed the rows returned; `limit` caps at 50). A '
                    .'`project_key` of `#bez-projektu` is not a project: it is the group of sessions whose '
                    .'working directory was a generated name like `mystifying-mclaren-23750a`, which means '
                    .'nothing. The full text of a record — its markdown description, the prompts, the '
                    .'file list — is NOT here, because one answer would eat the context window; read one '
                    .'whole with mind_read on its `id`. Empty fields are omitted, so a missing `project` '
                    .'means the session had no project name at all; `commit_count` of 0 is present and '
                    .'means the session committed nothing.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'project' => [
                            'type' => 'string',
                            'description' => 'Only records of this project — pass a `key` from project_groups, e.g. `#bez-projektu`',
                        ],
                        'limit' => ['type' => 'integer', 'description' => 'Max records (default 50, max 50)'],
                    ],
                ],
            ],
            [
                'name' => 'mind_directive',
                'description' => 'Assemble the whole Hades context for one task into a single ready prompt '
                    .'— the same document the human gets on the Smernica screen and pastes into a session. '
                    .'Give it a plain-language `task` (Slovak or English; keywords are enough): it searches '
                    .'the mind, drops noise nodes, and sorts what is left into verified skills WITH their '
                    .'.md paths, pitfalls, related projects, key facts and standing rules. Reach for it at '
                    .'the start of unfamiliar work INSTEAD of several mind_recall calls: one round trip, '
                    .'and it already says which files to read first. `markdown` is context, not the task '
                    .'itself. Its section "Pasce — čo nerobiť" holds verified past mistakes and is the most '
                    .'valuable part of the answer; do not repeat them. `counts` is how much the mind really '
                    .'had per category, so `counts.total` of 0 means Hades knows nothing here — say so '
                    .'instead of inventing. Skills under "bez .md v repo" have no file on disk, only a '
                    .'description; read them with mind_read. `node_ids` pins nodes you already know matter '
                    .'(ids from mind_recall) and those are never discarded as noise. Read-only: saving a '
                    ."directive to disk stays the human's action.",
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'task' => ['type' => 'string', 'description' => 'What you are about to work on, in plain words'],
                        'node_ids' => [
                            'type' => 'array',
                            'items' => ['type' => 'integer'],
                            'description' => 'Node ids to include no matter what (from mind_recall), max 50',
                        ],
                    ],
                    'required' => ['task'],
                ],
            ],
            [
                'name' => 'mind_library',
                'description' => 'List the playbooks (skill nodes) the mind holds, grouped by area, each '
                    .'with the path to its .md file. Use it before writing something down yourself, or when '
                    .'the user asks what Hades knows about a field: mind_recall answers a question with a '
                    .'handful of nodes, this answers "everything in this area, with the files" in one call. '
                    .'Narrow it — `area` takes an area slug or name from mind_overview, `q` matches Slovak '
                    .'inflected forms too. Unnarrowed you get the first 200 skills and `truncated` is true, '
                    .'which means you are holding a sample, not the library. `count` per area is how many '
                    .'skills matched, not how many rows you got, so a `count` above the rows you see is the '
                    .'rest of that area. `path` is where the playbook actually lives — read the file, never '
                    .'guess it from the label; a skill with no `path` has no file at all and mind_read '
                    .'gives you its description instead. `certainty` of `pasca` marks a mistake to avoid, '
                    .'not a recommendation.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'area' => ['type' => 'string', 'description' => 'Area slug or name, e.g. vyvoj-kod'],
                        'q' => ['type' => 'string', 'description' => 'Filter by word in the label or description'],
                        'limit' => ['type' => 'integer', 'description' => 'Max skills across areas (default 200, max 2000)'],
                    ],
                ],
            ],
            [
                'name' => 'mind_decisions',
                'description' => 'List the decisions recorded in the mind: what was decided, when, and '
                    .'why. Use it before proposing a direction the user may already have settled, and '
                    .'whenever the user asks why something is the way it is — a decision carries its '
                    .'`reason`, which is the part no code comment holds. Newest first. `area` is the '
                    ."area's name, not an id. `month` is the grouping key of the timeline. `origin` says "
                    .'where the record lives: `session` is a database-only note an AI wrote, `brain` is '
                    .'mirrored into a markdown file that `source_file` points at — a `brain` decision '
                    .'outranks a `session` one, because a human keeps that file. `counts` covers the whole '
                    .'corpus while `years` and `areas` are the axes with their own counts, so one call '
                    .'gives you both the decisions and their shape. Filters narrow server-side; `area` '
                    .'takes a slug from `areas`. Record a new decision with mind_decision. Empty fields '
                    .'are omitted: no `reason` means none was written down, no `area` means the decision '
                    .'is filed under none, no `source_file` means there is no markdown mirror.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'year' => ['type' => 'integer', 'description' => 'Only decisions decided in this year'],
                        'area' => ['type' => 'string', 'description' => 'Only this area — slug from `areas`, or its name'],
                        'origin' => [
                            'type' => 'string',
                            'enum' => ['session', 'brain'],
                            'description' => 'Only records of this provenance',
                        ],
                        'q' => ['type' => 'string', 'description' => 'Substring of the decision text or its reason'],
                        'limit' => ['type' => 'integer', 'description' => 'Max rows (default 500, max 500)'],
                    ],
                ],
            ],
            [
                'name' => 'mind_review',
                'description' => 'Read the review queue: knowledge the mind has learned but a human has '
                    .'not confirmed. Use it at the start of a session to see what you left unverified '
                    .'last time, and before learning something again — an entry already in this queue does '
                    .'not need a second mind_learn, it needs the human. Newest first. This tool is '
                    .'READ-ONLY and there is deliberately no verify counterpart: confirming a knowledge is '
                    ."the human's act, and an AI that approves its own memory has no external truth left. "
                    .'`total` is the whole queue and no filter ever narrows it, so that is the number to '
                    .'report; `counts.shown` is how many rows you actually got. `counts` breaks the queue '
                    .'down by type, certainty and origin (`bez` = not set) — that is what tells you '
                    .'whether traps are waiting or just unfiled memories. A `certainty` of `pasca` is a '
                    .'trap and worth raising first. Filters narrow server-side; `area` takes a slug from '
                    .'`areas`. Empty fields are omitted: no `description` means a bare label, which wants '
                    .'fixing rather than verifying; no `source_file` means the entry lives only in the '
                    .'index, not in a markdown file.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'area' => ['type' => 'string', 'description' => 'Only this area — slug from `areas`, or its name'],
                        'type' => [
                            'type' => 'string',
                            'enum' => ['memory', 'skill', 'project', 'core'],
                            'description' => 'Only nodes of this type',
                        ],
                        'certainty' => [
                            'type' => 'string',
                            'enum' => ['overene', 'hypoteza', 'pasca'],
                            'description' => 'Only nodes with this certainty',
                        ],
                        'origin' => [
                            'type' => 'string',
                            'enum' => ['session', 'brain'],
                            'description' => 'Only nodes of this provenance',
                        ],
                        'q' => ['type' => 'string', 'description' => 'Substring of the label or the description'],
                        'limit' => ['type' => 'integer', 'description' => 'Max rows (default 100, max 500)'],
                    ],
                ],
            ],
            [
                'name' => 'mind_chat_search',
                'description' => 'Search the text of past Charon conversations — the chat history, not the '
                    .'memory graph. Use it when the user refers to something you discussed before ("what '
                    .'did we decide about the write gate?") and mind_recall comes back empty, because a '
                    .'conversation is not a node: it is only in the mind if someone stored it with '
                    .'mind_learn. Matching is substring, case-insensitive for ASCII, and the human\'s '
                    .'`%` and `_` are text, not wildcards. Snippets are cut around the hit, so read one '
                    .'in full with the thread uuid if the context matters. The system directive is never '
                    .'searchable — it is configuration, not a turn, and it would otherwise match in every '
                    .'thread. Abandoned branches ARE searchable on purpose: a decision that was later '
                    .'forked away still happened.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'q' => [
                            'type' => 'string',
                            'description' => 'What to look for; at least 2 characters',
                        ],
                        'thread' => [
                            'type' => 'string',
                            'description' => 'Limit to one thread (uuid)',
                        ],
                        'role' => [
                            'type' => 'string',
                            'description' => 'Only `user` or only `assistant` turns',
                        ],
                        'limit' => [
                            'type' => 'integer',
                            'description' => 'How many hits to return',
                        ],
                    ],
                    'required' => ['q'],
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
                'mind_update' => $this->toolUpdate($args, $mind),
                'mind_link' => $this->toolLink($args, $mind),
                'mind_chat_search' => $this->toolChatSearch($args),
                'mind_hygiene' => $this->toolHygiene($args),
                'mind_runs' => $this->toolRuns($args),
                'mind_run' => $this->toolRun($args),
                'mind_today' => app(DnesScreen::class)->forAi(),
                'mind_journal' => (new DennikScreen($args))->forAi(),
                'mind_directive' => (new SmernicaScreen($args))->forAi(),
                'mind_library' => (new KniznicaScreen($args))->forAi(),
                'mind_decisions' => (new RozhodnutiaScreen($args))->forAi(),
                'mind_review' => (new KontrolaScreen($args))->forAi(),
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

    /**
     * Log behov pre AI — TÁ ISTÁ trieda, z ktorej čítá obrazovka Runy.
     *
     * `forAi()` je len `data()` prefiltrované deklarovaným zoznamom kľúčov, takže
     * medzi tým, čo vidí človek, a tým, čo dostane AI, nestojí druhá
     * implementácia. Keď sa obrazovka zmení, AI to dostane zadarmo — a keď sa
     * niekto pokúsi jednu z plôch dopočítať zvlášť, zhodí to parity test.
     */
    protected function toolRuns(array $args): array
    {
        return (new RunsScreen($args))->forAi();
    }

    protected function toolRun(array $args): array
    {
        $uuid = trim((string) ($args['uuid'] ?? ''));

        if ($uuid === '') {
            throw new \InvalidArgumentException('mind_run needs the uuid of a run — list them with mind_runs.');
        }

        $run = Run::query()->with('thread:id,uuid,title')->where('uuid', $uuid)->first();

        if ($run === null) {
            throw new \InvalidArgumentException("No run with uuid {$uuid}.");
        }

        return (new RunDetailScreen($run))->forAi();
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

    /**
     * Oprava popisu existujúceho uzla.
     *
     * Prečo to musí existovať: `mind_learn` s tým istým labelom NEPREPÍŠE, ale
     * zlúči — popis PRIPOJÍ pod pôvodný (viď MindService::mergeInto). 19. 8. 2026
     * sa tým do uzla 2700 (typ „pasca") dostalo nesprávne číslo ako prvé tvrdenie
     * a oprava pod ním; opraviť sa to dalo len jednorazovým PHP skriptom
     * (storage/app/fix-node-2700.php), lebo MCP nemalo ako popis prepísať.
     *
     * Default je PREPIS a je zámerne explicitný, nie odvodený: „pripoj, ak sa
     * nový text nezhoduje" je presne to chytré správanie, ktoré tú pascu vyrobilo.
     *
     * Vektor uzla sa tu ZÁMERNE nepočíta znova. `EmbeddingService::sourceHash()`
     * sa mení s textom, takže uzol sa sám označí za `stale` a prepočíta ho dávka
     * (mind:embed) — zápisová cesta MCP tak nezávisí od toho, či práve beží
     * lokálny model. Do najbližšej dávky preto semantická vetva recallu ešte
     * pozná starý text.
     */
    protected function toolUpdate(array $args, MindService $mind): array
    {
        $node = $this->requireNodeBy($args, 'id', 'label', $mind);

        $incoming = trim((string) ($args['description'] ?? ''));

        if ($incoming === '') {
            throw new \InvalidArgumentException(
                'Missing required argument: description. To remove a node use mind_delete, '
                .'not an empty description.'
            );
        }

        $mode = (string) ($args['mode'] ?? 'replace');

        if (! in_array($mode, ['replace', 'append'], true)) {
            throw new \InvalidArgumentException("Unknown mode: {$mode}. Use replace (default) or append.");
        }

        // serverová poistka blacklistu — rovnaká ako v mind_learn/mind_decision
        if ($this->looksLikeSecret($incoming)) {
            return [
                'content' => [[
                    'type' => 'text',
                    'text' => 'Odmietnuté: text vyzerá ako heslo/API kľúč/token — to do vedomia nepatrí (pravidlo blacklistu).',
                ]],
                'isError' => true,
            ];
        }

        $certainty = null;
        if (! blank($args['certainty'] ?? null)) {
            $certainty = (string) $args['certainty'];

            if (! in_array($certainty, self::CERTAINTY, true)) {
                throw new \InvalidArgumentException(
                    "Unknown certainty: {$certainty}. Known: ".implode(', ', self::CERTAINTY).'.'
                );
            }
        }

        $current = trim((string) $node->description);

        $node->description = $mode === 'append' && $current !== ''
            // rovnaký oddeľovač ako pri zlúčení (mergeInto), nech uzol nemá dva
            // rôzne tvary „viac odsekov v popise"
            ? $current."\n".$incoming
            : $incoming;

        if ($certainty !== null) {
            $node->certainty = $certainty;
        }

        $node->save();

        // Tagy sa PRIDÁVAJÚ. Odoberať ich cez MCP sa nedá zámerne: tag je jediná
        // väzba, ktorou uzol vstupuje do cudzích dopytov, a jej tiché odobranie by
        // sa v odpovedi nijako neprejavilo.
        $tagIds = [];
        foreach ((array) ($args['tags'] ?? []) as $name) {
            if ($tag = Tag::forName(trim((string) $name))) {
                $tagIds[] = $tag->id;
            }
        }

        if ($tagIds !== []) {
            $node->tags()->syncWithoutDetaching($tagIds);
        }

        $fresh = $node->fresh();
        MindPulse::dispatch('node.updated', ['node' => $fresh->toApi()]);

        // `label` je jediné, čo volajúci ešte nevie (mal len id) — a je to jeho
        // kontrola, že prepísal ten uzol, ktorý chcel. `chars` je dôkaz o dĺžke
        // uloženého textu; nič ďalšie sa neposiela, mód aj tagy poslal sám.
        return [
            'action' => 'updated',
            'label' => $fresh->label,
            'chars' => mb_strlen((string) $fresh->description),
        ];
    }

    /**
     * Ručné prepojenie dvoch uzlov — jediná cesta, ktorou sa pochopený vzťah
     * dostane do grafu. Hrany inak vznikajú výhradne strojovo (co-aktivácia
     * v session, zmienka labelu, vektorová podobnosť), takže AI, ktorá práve
     * zistila, že dve veci súvisia, to doteraz nemala kde povedať.
     */
    protected function toolLink(array $args, MindService $mind): array
    {
        $a = $this->requireNodeBy($args, 'from_id', 'from', $mind);
        $b = $this->requireNodeBy($args, 'to_id', 'to', $mind);

        if ($a->id === $b->id) {
            throw new \InvalidArgumentException(
                'Refused: a node cannot be linked to itself ('.$a->label.').'
            );
        }

        $relation = null;
        if (! blank($args['relation'] ?? null)) {
            $relation = (string) $args['relation'];

            if (! in_array($relation, self::LINK_RELATIONS, true)) {
                throw new \InvalidArgumentException(
                    "Unknown relation: {$relation}. Known: ".implode(', ', self::LINK_RELATIONS)
                    .'. Omit it when neither fits.'
                );
            }
        }

        // Hrana je neorientovaná a v tabuľke sedí s nižším id ako source (viď
        // MindService::connect) — hľadať ju treba v tomto kanonickom poradí.
        [$sourceId, $targetId] = $a->id < $b->id ? [$a->id, $b->id] : [$b->id, $a->id];

        $edge = Edge::query()
            ->where('source_id', $sourceId)
            ->where('target_id', $targetId)
            ->first();

        $existed = $edge !== null;

        // Idempotencia nie je kozmetika: `connect()` by pri existujúcej hrane
        // váhu inkrementoval, takže AI, ktorá si to isté spojenie potvrdí trikrát,
        // by vyrobila hranu ťažšiu než akú dá skutočná opakovaná co-aktivácia.
        if (! $existed) {
            $edge = $mind->connect($a, $b);

            // connect() vracia null, len keď medzitým zanikol uzol — tu sú oba
            // práve načítané, takže je to skutočná chyba, nie stav na preskočenie
            if ($edge === null) {
                throw new \RuntimeException('Link failed: one of the nodes disappeared meanwhile.');
            }
        }

        // Relácia sa DOPLŇUJE, nikdy neprepisuje — to isté pravidlo, aké drží
        // mind:rewire (backfillRelations berie len hrany s relation = null).
        if ($relation !== null && blank($edge->relation)) {
            $edge->forceFill(['relation' => $relation])->save();
        }

        return $this->dropEmpty([
            'action' => $existed ? 'already_linked' : 'linked',
            // labely sú to jediné nové: volajúci mal id a potrebuje vidieť, že
            // spojil tie uzly, ktoré chcel
            'nodes' => [$a->label, $b->label],
            // výsledná relácia, nie tá vyžiadaná — pri už označenej hrane sa
            // volajúci takto dozvie, že jeho `relation` neprešla
            'relation' => $edge->relation,
        ]);
    }

    /**
     * Hygienická správa pre session — len na čítanie a TÁ ISTÁ trieda, z ktorej
     * čerpá sekcia „Hygiena" na obrazovke Kontrola.
     *
     * Klasifikátor je JEDEN a je v `mind:hygiene` (ten zase stojí na
     * `MindService::noiseOf()`); `HygienaScreen` ho volá a nepíše druhú kópiu
     * pravidiel. Do vlny F bol tvar odpovede poskladaný priamo tu, takže odpad
     * videla len AI — človek v appke nemal ako (nález A3). Teraz je to `data()`
     * prefiltrované deklarovaným zoznamom kľúčov a plochy drží pri sebe
     * `ScreenParityTest`.
     *
     * Payload sa nezmenil ani o kľúč: `nodes`, `edges`, `dirty_nodes`,
     * `classes[]` (bez tried s nulou, `examples` sú len id) a `worst[]`
     * s labelom. Zápisové cesty tu nie sú a nebudú — opravy idú cez
     * `mind_rename` / `mind_move` / `mind_update`, kde je vidieť, čo presne sa
     * deje s ktorým uzlom.
     */
    /**
     * Hľadanie v histórii konverzácií — TÁ ISTÁ plocha, akú dostane človek na
     * `GET /api/console/search`. Jeden serializér, dve projekcie: endpoint vráti
     * `data()`, tool `dropEmpty(project(data(), fieldsForAi()))`. Bez tohto toolu
     * by `ChatScreen::fieldsForAi()` sľuboval plochu, ktorú nikto nevolá.
     */
    protected function toolChatSearch(array $args): array
    {
        return (new ChatScreen($args))->forAi();
    }

    protected function toolHygiene(array $args): array
    {
        return (new HygienaScreen($args))->forAi();
    }

    /**
     * Uzol pre nástroje, ktoré menia konkrétny uzol: najprv `id`, potom presný
     * label. Neznáme `id` je CHYBA, nie dôvod skúsiť label — pri zápise je
     * „skoro ten správny uzol" horší výsledok než odmietnutie (to isté pravidlo
     * ako v {@see requireNode}).
     *
     * `id` musí byť v ponuke, hoci recall ho nevracia: uzly bez použiteľného
     * labelu (surový prompt, slug) sa inak nedajú osloviť vôbec — a práve tie
     * treba opraviť. Ich id dá `mind_hygiene`.
     */
    protected function requireNodeBy(array $args, string $idKey, string $labelKey, MindService $mind): Node
    {
        $id = $args[$idKey] ?? null;

        if (! blank($id) && ctype_digit((string) $id)) {
            $node = Node::find((int) $id);

            if (! $node) {
                throw new \InvalidArgumentException(
                    "No live node with {$idKey} ".(int) $id.'. Ids come from mind_hygiene or from the '
                    .'mind_learn/mind_activate response; a deleted node has none.'
                );
            }

            return $node;
        }

        if (blank($args[$labelKey] ?? null)) {
            throw new \InvalidArgumentException(
                "Missing required argument: {$idKey} (node id) or {$labelKey} (its exact label)."
            );
        }

        $node = $mind->findExact((string) $args[$labelKey]);

        if (! $node) {
            throw new \InvalidArgumentException(
                'No single node matches label: '.$args[$labelKey]
                .'. Use mind_recall to find its exact label first.'
            );
        }

        return $node;
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
