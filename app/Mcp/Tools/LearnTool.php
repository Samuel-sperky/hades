<?php

namespace App\Mcp\Tools;

use App\Mcp\Concerns\ValidatesArgs;
use App\Mcp\Tool;
use App\Services\Brain\SecretScanner;
use App\Services\MindService;

/**
 * `aura_learn` — zapíše nový poznatok do vedomia.
 *
 * Serverová poistka blacklistu ostáva: label ani popis nesmú vyzerať ako heslo,
 * API kľúč či token. Detekcia je delegovaná na {@see SecretScanner} (jediný
 * zdroj pravdy, zdieľaný s brain-write) a nikdy nevracia matched hodnotu.
 */
class LearnTool implements Tool
{
    use ValidatesArgs;

    /** Povolené úrovne istoty — musí sedieť s enumom v schéme. */
    private const CERTAINTY = ['overene', 'hypoteza', 'pasca'];

    private const NODE_TYPES = ['skill', 'memory', 'project'];

    public function __construct(
        private readonly MindService $mind,
        private readonly SecretScanner $secrets,
    ) {}

    public function name(): string
    {
        return 'aura_learn';
    }

    public function description(): string
    {
        return 'Store a significant new piece of knowledge in the mind: a skill the '
            .'assistant demonstrated, an important fact/memory about the user, or a project. '
            .'Duplicates are merged automatically — call it freely. Use Slovak for personal '
            .'facts and projects, English for technical skill names. Only store significant '
            .'knowledge, never secrets (passwords, API keys, financial/health data).';
    }

    public function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'type' => [
                    'type' => 'string',
                    'enum' => self::NODE_TYPES,
                    'description' => 'skill = a capability; memory = a fact about the user or world; project = ongoing work',
                ],
                'label' => ['type' => 'string', 'description' => 'Short node name, max ~5 words'],
                'description' => ['type' => 'string', 'description' => 'One to three sentences of detail'],
                'area' => [
                    'type' => 'string',
                    'description' => 'Target area name — one of the areas returned by aura_overview',
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
                    'enum' => self::CERTAINTY,
                    'description' => 'Confidence level: overene = verified/proven, '
                        .'hypoteza = hypothesis to confirm, pasca = pitfall/gotcha to avoid',
                ],
                'tags' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                    'description' => 'Free-form tags (many-to-many) to categorise the node',
                ],
                'session_key' => SessionKey::schema(),
            ],
            'required' => ['type', 'label', 'area'],
        ];
    }

    public function handle(array $args): array
    {
        $type = $this->requireString($args, 'type');
        $label = $this->requireString($args, 'label');
        $area = $this->requireString($args, 'area');
        $description = $this->optionalString($args, 'description');

        if ($this->looksLikeSecret($label) || ($description !== null && $this->looksLikeSecret($description))) {
            return $this->rejected(
                'Odmietnuté: obsah vyzerá ako heslo/API kľúč/token — tie do vedomia nepatria (pravidlo blacklistu).',
            );
        }

        return $this->mind->learn(
            type: $type,
            label: $label,
            description: $description,
            areaName: $area,
            departmentName: $this->optionalString($args, 'department'),
            connections: $this->stringList($args, 'connections'),
            sessionKey: $this->optionalString($args, 'session_key'),
            certainty: $this->requireEnum($args, 'certainty', self::CERTAINTY),
            tags: $this->stringList($args, 'tags'),
        );
    }

    /** Hotová MCP odpoveď s odmietnutím — nikdy neobsahuje zachytenú hodnotu. */
    private function rejected(string $reason): array
    {
        return [
            'content' => [['type' => 'text', 'text' => $reason]],
            'isError' => true,
        ];
    }

    private function looksLikeSecret(string $text): bool
    {
        return $this->secrets->looksLikeSecret($text);
    }
}
