<?php

namespace App\Services\Console\Tools;

use App\Models\Node;
use App\Services\Brain\SecretScanner;
use App\Services\Console\ToolResult;
use App\Services\MindService;

/**
 * Premenovanie uzla — jediná oprava odpadového labelu, ktorá nič nestratí.
 *
 * Nový názov ide cez to isté sito ako `mind_learn` ({@see MindService::noiseOf()}):
 * tool existuje na to, aby sa markdownom zmrzačený label dal opraviť, takže
 * pustiť doňho iný markdownový label by bolo presne naopak. Popis sa pri sonde
 * berie z uzla, nie z argumentov — kontroluje sa MENO, nie znalosť.
 */
final class MindRenameTool extends BaseTool
{
    use ResolvesNode;

    public function __construct(
        private readonly MindService $mind,
        private readonly SecretScanner $secrets,
    ) {}

    public function name(): string
    {
        return 'mind_rename';
    }

    public function description(): string
    {
        return 'Rename ONE node of the mind. Use it to fix a junk label — a node whose name is markdown, a '
            .'raw sentence from a conversation or a machine slug (mind_recall marks those with `noise`). The '
            .'new label must be a plain short name, not a sentence. Nothing else about the node changes. '
            .'This is a WRITE — the user has to confirm it.';
    }

    public function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'id' => ['type' => 'integer', 'description' => 'Node id from mind_recall.'],
                'label' => ['type' => 'string', 'description' => 'Exact current label — only when you have no id.'],
                'new_label' => ['type' => 'string', 'description' => 'The new short name.'],
            ],
            'required' => ['new_label'],
        ];
    }

    public function isWrite(): bool
    {
        return true;
    }

    public function preview(array $args): ?string
    {
        [$node, $new] = $this->target($args);

        return "Premenovanie uzla #{$node->id}\n- {$node->label}\n+ {$new}";
    }

    public function execute(array $args): ToolResult
    {
        [$node, $new] = $this->target($args);

        $before = $node->label;
        $node = $this->mind->rename($node, $new);

        return ToolResult::json([
            'action' => 'renamed',
            'id' => $node->id,
            'from' => $before,
            'to' => $node->label,
        ]);
    }

    /**
     * @param  array<string, mixed>  $args
     * @return array{0: Node, 1: string}
     *
     * @throws ToolRefusal
     */
    private function target(array $args): array
    {
        $node = $this->resolveNode($args, $this->mind);
        $new = $this->requiredString($args, 'new_label');

        if ($new === $node->label) {
            throw new ToolRefusal('Refused: `new_label` is identical to the current label — nothing to do.');
        }

        if ($this->secrets->looksLikeSecret($new)) {
            throw new ToolRefusal('Refused: the new label looks like a password, API key or token.');
        }

        // Sonda nesie NOVÝ label a PÔVODNÝ popis: „stub" by tu inak vypadol vždy,
        // keď má uzol krátky popis — a to nie je vada premenovania.
        $probe = new Node;
        $probe->label = $new;
        $probe->description = (string) $node->description;

        $reason = $this->mind->noiseOf($probe);

        if ($reason !== null && $reason !== 'stub') {
            throw new ToolRefusal(
                "Refused: `new_label` is the same kind of junk ({$reason}) that rename exists to fix. "
                .'Give a plain short name — 2-6 words, no markdown, not a sentence.'
            );
        }

        return [$node, $new];
    }
}
