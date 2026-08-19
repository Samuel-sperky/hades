<?php

namespace App\Services\Console\Tools;

use App\Services\Console\ToolResult;
use App\Services\MindService;

/**
 * Zmazanie uzla — VRATNÉ, cez {@see MindService::softDelete()}.
 *
 * Nikdy `Node::forceDelete()` a nikdy `DELETE`. Dva dôvody, oba zaplatené:
 *  - Pamäť je jediná kópia. Model, ktorý sa mýli v tom, čo je odpad, nesmie mať
 *    v ruke nevratnú operáciu; človek potvrdzuje jeden klik a nevie, čo v uzle bolo.
 *  - Náhrobok (`tombstones`) je funkčná nutnosť, nie kozmetika: bez neho by
 *    najbližší ingest ten istý `external_key` znovu adoptoval a odpadový uzol by
 *    sa vrátil.
 *
 * Uzol teda v tabuľke zostane s `deleted_at`, hrany sa nedotkneme a
 * `mind:restore` ho vie vrátiť.
 */
final class MindDeleteTool extends BaseTool
{
    use ResolvesNode;

    public function __construct(private readonly MindService $mind) {}

    public function name(): string
    {
        return 'mind_delete';
    }

    public function description(): string
    {
        return 'Delete ONE node from the mind. Use it only for real junk — a node that carries no knowledge, '
            .'or a duplicate that cannot be merged. The delete is REVERSIBLE (the node is hidden from recall '
            .'and the graph, its connections are kept, and it can be restored), so say so if the user asks. '
            .'Prefer mind_rename when only the name is wrong. This is a WRITE — the user has to confirm it.';
    }

    public function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'id' => ['type' => 'integer', 'description' => 'Node id from mind_recall.'],
                'label' => ['type' => 'string', 'description' => 'Exact label — only when you have no id.'],
                'reason' => ['type' => 'string', 'description' => 'Short reason, stored with the tombstone.'],
            ],
            'required' => [],
        ];
    }

    public function isWrite(): bool
    {
        return true;
    }

    public function preview(array $args): ?string
    {
        $node = $this->resolveNode($args, $this->mind, ['area']);
        $description = trim((string) $node->description);

        $lines = [
            "Zmazanie uzla #{$node->id} (vratné — dá sa obnoviť)",
            'typ:      '.$node->type,
            'názov:    '.$node->label,
            'oblasť:   '.($node->area?->name ?? '—'),
            'sila:     '.(float) $node->strength,
            '',
            // Človek potvrdzuje jediným klikom, takže musí vidieť, aká znalosť
            // zmizne — nie len meno uzla.
            $description === '' ? '(uzol nemá popis)' : mb_strimwidth($description, 0, 600, ' …'),
        ];

        return implode("\n", $lines);
    }

    public function execute(array $args): ToolResult
    {
        $node = $this->resolveNode($args, $this->mind);
        $label = $node->label;
        $id = $node->id;

        $this->mind->softDelete($node, $this->optionalString($args, 'reason') ?? 'console');

        return ToolResult::json([
            'action' => 'deleted',
            'id' => $id,
            'label' => $label,
            'reversible' => true,
            'note' => 'Soft-deleted: hidden from recall and the graph, edges kept, restorable.',
        ]);
    }
}
