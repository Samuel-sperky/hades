<?php

namespace App\Services\Chat;

use App\Models\Node;
use App\Services\NodeMarkdownResolver;

/**
 * „Priložený kontext" z uzlov, ktoré používateľ pripol k otázke (čipy uzlov,
 * rozhodnutie #92). Vlastník P5.
 *
 * Prenesené z `ChatController::buildContext()` — rovnaké stropy (20 uzlov,
 * 6 000 znakov, 1 500 znakov markdownu na uzol), len bez controlleru.
 */
final class NodeContextBuilder
{
    private const MAX_NODES = 20;

    private const BUDGET = 6_000;

    private const MD_PER_NODE = 1_500;

    public function __construct(private readonly NodeMarkdownResolver $resolver) {}

    /** @param  array<int, int|string>  $ids */
    public function build(array $ids): string
    {
        $ids = array_slice(array_values(array_unique(array_map('intval', $ids))), 0, self::MAX_NODES);
        if ($ids === []) {
            return '';
        }

        $nodes = Node::whereIn('id', $ids)->get();
        if ($nodes->isEmpty()) {
            return '';
        }

        $used = 0;
        $parts = [];

        foreach ($nodes as $node) {
            $chunk = '### '.$node->label."\n";

            $description = trim((string) $node->description);
            if ($description !== '') {
                $chunk .= $description."\n";
            }

            // Markdown snippet — len keď nesie viac než len popis.
            $md = trim((string) ($this->resolver->resolve($node)['markdown'] ?? ''));
            if ($md !== '' && $md !== $description) {
                $chunk .= "\n".mb_substr($md, 0, self::MD_PER_NODE)."\n";
            }

            $len = mb_strlen($chunk);
            if ($used + $len > self::BUDGET) {
                $remaining = self::BUDGET - $used;
                if ($remaining <= 0) {
                    break;
                }
                $parts[] = mb_substr($chunk, 0, $remaining);
                break;
            }

            $parts[] = $chunk;
            $used += $len;
        }

        return trim(implode("\n", $parts));
    }

    /** @param  array<int, int|string>  $ids  @return list<int> */
    public function existingIds(array $ids): array
    {
        $ids = array_slice(array_values(array_unique(array_map('intval', $ids))), 0, self::MAX_NODES);
        if ($ids === []) {
            return [];
        }

        return Node::whereIn('id', $ids)->pluck('id')->map('intval')->values()->all();
    }
}
