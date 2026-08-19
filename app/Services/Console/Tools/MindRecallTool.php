<?php

namespace App\Services\Console\Tools;

use App\Models\Node;
use App\Services\Console\ToolResult;
use App\Services\MindService;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Support\Str;

/**
 * Vybavenie z pamäte — obal nad {@see MindService::recallWithMeta()}.
 *
 * Skórovanie sa tu NEROBÍ. Recall má jeden engine (kľúčové slová + vektory,
 * fúzované RRF) a druhá kópia jeho pravidiel by sa rozišla s prvou v týždni;
 * tool je preto len tvar odpovede pre model, nič viac.
 *
 * Odpoveď je zámerne chudobnejšia než v MCP: `id` navrch (aby sa dal uzol
 * dočítať bez hádania labelu) a popis zrezaný na config strop. Lokálny model má
 * 16k kontextu na CELÉ vlákno vrátane súborov — jeden bohatý recall by ho zjedol.
 */
final class MindRecallTool extends BaseTool
{
    public function __construct(private readonly MindService $mind) {}

    public function name(): string
    {
        return 'mind_recall';
    }

    public function description(): string
    {
        return 'Search the mind (the user\'s long-term memory of skills, projects, decisions and traps) '
            .'and return the nodes that match. Use it BEFORE answering anything about the user, their '
            .'projects, their conventions or past decisions — the mind holds facts you cannot know otherwise. '
            .'Query in the user\'s own words; the query is stemmed and also matched semantically, so a '
            .'paraphrase works. Returns a compact list: id, label, type (skill/memory/project), area, '
            .'relevance 0-1, a shortened description, and `related` labels. `via` means the node was pulled '
            .'in by a connection, not by a direct match. `noise` marks a node whose own label is junk — do '
            .'not trust it as a source. When `description_truncated` is true, read the whole node with '
            .'mind_read using the id.';
    }

    public function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'query' => [
                    'type' => 'string',
                    'description' => 'What to remember, in natural language (Slovak or English).',
                ],
                'limit' => [
                    'type' => 'integer',
                    'description' => 'How many nodes at most (1-30, default 8).',
                ],
                'areas' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                    'description' => 'Optional: restrict to these area names from mind_overview.',
                ],
            ],
            'required' => ['query'],
        ];
    }

    public function execute(array $args): ToolResult
    {
        $query = $this->requiredString($args, 'query');
        $areas = $this->stringList($args, 'areas');

        // Default 8 (nie 12 ako v MCP): každý uzol navyše je na CPU inferencii
        // zaplatený sekundami, a konzola na rozdiel od Claude Code kontext nemá kde vziať.
        $limit = max(1, min($this->optionalInt($args, 'limit') ?? 8, 30));

        $recall = $this->mind->recallWithMeta($query, $limit, null, $areas === [] ? null : $areas);

        /** @var EloquentCollection<int, Node> $nodes */
        $nodes = EloquentCollection::make($recall['nodes']->all());
        // Bez eager-loadu si tagy ťahá každý uzol vlastným dotazom (N+1) —
        // presne to isté, čo bolo treba zaplatiť v McpController.
        $nodes->load('tags');

        $meta = $recall['meta'];
        $descCap = max(1, (int) config('hades.recall_desc_chars', 300));
        $neighborCap = max(1, (int) config('hades.recall_desc_neighbor_chars', 200));
        $tagCap = max(0, (int) config('hades.recall_tag_cap', 8));

        $rows = $nodes->values()->map(function (Node $node) use ($meta, $descCap, $neighborCap, $tagCap) {
            $m = $meta[$node->id] ?? [];
            $via = $m['via'] ?? null;
            $full = trim((string) $node->description);
            $cap = $via !== null ? $neighborCap : $descCap;

            // Úryvok okolo zhody nesie viac signálu než slepý začiatok popisu —
            // ale len keď sa popis do stropu nezmestí, inak by orezal text,
            // ktorý by sa bol vošiel celý.
            $text = ($via === null && ! empty($m['snippet']) && mb_strlen($full) > $cap)
                ? (string) $m['snippet']
                : $full;
            $text = (string) Str::limit($text, $cap);

            return array_filter([
                'id' => $node->id,
                'label' => $node->label,
                'type' => $node->type,
                'area' => $node->area?->name,
                'relevance' => $m['relevance'] ?? null,
                'via' => $via,
                'certainty' => $node->certainty,
                'tags' => array_slice($node->tags->pluck('name')->all(), 0, $tagCap),
                'noise' => $m['noise'] ?? null,
                'related' => $m['related'] ?? [],
                'description' => $text,
                'description_truncated' => $text !== $full,
                // Prázdne polia sa neposielajú (kánon MCP odpovede) — `false` a
                // `null` sú na každom uzle 20 B za nulovú informáciu.
            ], fn ($v) => $v !== null && $v !== false && $v !== '' && $v !== []);
        })->all();

        $out = [
            'found' => count($rows),
            // ako bol dopyt pochopený — keď recall vráti nezmysly, model vidí prečo
            'terms' => $recall['terms'],
            'nodes' => $rows,
        ];

        if ($out['found'] === 0) {
            $out['hint'] = 'Nothing matched. Try other words (see `terms` for how the query was stemmed), '
                .'drop `areas`, or call mind_overview to see what the mind holds.';
        }

        return ToolResult::json($out);
    }
}
