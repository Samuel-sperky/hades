<?php

namespace App\Mcp\Tools;

use App\Mcp\Concerns\ValidatesArgs;
use App\Mcp\Tool;
use App\Models\Area;
use App\Models\Decision;
use App\Services\Brain\SecretScanner;
use Illuminate\Support\Str;

/**
 * `aura_decision` — zapíše rozhodnutie do časovej osi ako DB záznam
 * origin=session. Funguje bez ohľadu na brain-write guard; markdown zrkadlo sa
 * z MCP NEpíše (na to slúži REST DecisionController pri guard ON).
 */
class DecisionTool implements Tool
{
    use ValidatesArgs;

    public function __construct(private readonly SecretScanner $secrets) {}

    public function name(): string
    {
        return 'aura_decision';
    }

    public function description(): string
    {
        return 'Record a decision on the mind\'s timeline: a choice made and (optionally) '
            .'why. Stored as a session decision (origin=session) — works regardless of the '
            .'brain-write guard. Use Slovak for the decision text. Never store secrets.';
    }

    public function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'text' => ['type' => 'string', 'description' => 'What was decided (one to three sentences)'],
                'reason' => ['type' => 'string', 'description' => 'Why — the rationale behind the decision'],
                'area' => [
                    'type' => 'string',
                    'description' => 'Target area name — one of the areas returned by aura_overview',
                ],
                'decided_on' => [
                    'type' => 'string',
                    'description' => 'Decision date (YYYY-MM-DD); defaults to today when omitted',
                ],
            ],
            'required' => ['text'],
        ];
    }

    public function handle(array $args): array
    {
        $text = trim($this->requireString($args, 'text'));
        $reason = $this->optionalString($args, 'reason');

        // serverová poistka blacklistu — rozhodnutie nesmie niesť heslo/kľúč/token
        if ($this->secrets->looksLikeSecret($text) || ($reason !== null && $this->secrets->looksLikeSecret($reason))) {
            return [
                'content' => [[
                    'type' => 'text',
                    'text' => 'Odmietnuté: rozhodnutie vyzerá ako heslo/API kľúč/token — to do vedomia nepatrí (pravidlo blacklistu).',
                ]],
                'isError' => true,
            ];
        }

        $area = $this->optionalString($args, 'area');

        $decision = Decision::create([
            'area_id' => $area !== null ? $this->resolveAreaId($area) : null,
            'decided_on' => $this->optionalString($args, 'decided_on') ?? now()->toDateString(),
            'text' => $text,
            'reason' => $reason,
            'origin' => 'session',
        ]);

        return ['action' => 'decided', 'decision' => $decision->toApi()];
    }

    /** Oblasť podľa id (numerické) alebo slug/mena → area_id alebo null. */
    private function resolveAreaId(string $area): ?int
    {
        if (ctype_digit($area)) {
            return Area::whereKey((int) $area)->value('id');
        }

        return Area::where('slug', Str::slug($area))
            ->orWhereRaw('LOWER(name) = ?', [mb_strtolower(trim($area))])
            ->value('id');
    }
}
