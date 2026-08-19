<?php

namespace App\Services\Console\Tools;

use App\Models\Node;
use App\Services\Brain\SecretScanner;
use App\Services\Console\ToolResult;
use App\Services\MindService;

/**
 * Zápis nového poznatku do pamäte — a zároveň filter, ktorý do nej nepustí odpad.
 *
 * Tu sa to láme. Pamäť má dnes uzly s labelom „# Smernica: produkt foto
 * automatizacia" a „…nasadíme do dockeru a", pretože ich tam napísal model, ktorý
 * poslal ako `label` prvých N znakov promptu. Slabý lokálny model je presne ten
 * druh pisateľa, ktorý to urobí znova — a `mind_learn` je jediné miesto, kde sa
 * to dá zastaviť. Nie v UI: človek, ktorý potvrdzuje zápis, vidí label a nevie,
 * že o dva týždne bude v recalle ako šum.
 *
 * Klasifikáciu si tento tool NEVYMÝŠĽA — hodí kandidáta do
 * {@see MindService::noiseOf()}, teda do toho istého sita, ktorým recall označuje
 * existujúci odpad. Jeden kánon: čo by recall označil ako odpad, sa nezapíše.
 * Rozdiel je len v dôsledku — recall odpad označí, tu sa odmieta.
 */
final class MindLearnTool extends BaseTool
{
    public function __construct(
        private readonly MindService $mind,
        private readonly SecretScanner $secrets,
    ) {}

    public function name(): string
    {
        return 'mind_learn';
    }

    public function description(): string
    {
        return 'Store ONE new piece of knowledge in the mind: a skill, a memory (a fact about the user or a '
            .'decision) or a project. Call mind_overview first and pick an existing `area`. `label` must be a '
            .'NAME, short and in title case ("Docker Compose v Hadese", "Font subset pre Material Symbols") '
            .'— never a sentence, never a question, never the user\'s prompt, never markdown. `description` '
            .'carries the actual knowledge and must be a real explanation (at least 15 characters); write '
            .'WHY, not WHAT. Technical skills get English names, personal facts and projects Slovak ones. '
            .'Never store passwords, API keys, tokens, financial or health data. A near-duplicate is merged '
            .'automatically, so do not try to avoid one. This is a WRITE — the user has to confirm it.';
    }

    public function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'type' => [
                    'type' => 'string',
                    'enum' => ['skill', 'memory', 'project'],
                    'description' => 'skill = something that can be done, memory = a fact or decision, '
                        .'project = a thing being built.',
                ],
                'label' => [
                    'type' => 'string',
                    'description' => 'Short name of the knowledge. A name, not a sentence.',
                ],
                'description' => [
                    'type' => 'string',
                    'description' => 'The knowledge itself, in Slovak. At least 15 characters.',
                ],
                'area' => [
                    'type' => 'string',
                    'description' => 'Existing area name from mind_overview.',
                ],
                'department' => [
                    'type' => 'string',
                    'description' => 'Optional department inside that area, from mind_overview.',
                ],
                'tags' => [
                    'type' => 'array',
                    'items' => ['type' => 'string'],
                    'description' => 'Optional tags — reuse the names from mind_overview `top_tags`.',
                ],
                'certainty' => [
                    'type' => 'string',
                    'enum' => ['overene', 'hypoteza', 'pasca'],
                    'description' => 'Optional: overene = verified, hypoteza = a guess, pasca = a trap to avoid.',
                ],
            ],
            'required' => ['type', 'label', 'description', 'area'],
        ];
    }

    public function isWrite(): bool
    {
        return true;
    }

    public function preview(array $args): ?string
    {
        $input = $this->validated($args);

        $lines = [
            'Nový uzol v pamäti',
            'typ:      '.$input['type'],
            'názov:    '.$input['label'],
            'oblasť:   '.$input['area'].($input['department'] !== null ? ' / '.$input['department'] : ''),
        ];

        if ($input['certainty'] !== null) {
            $lines[] = 'istota:   '.$input['certainty'];
        }

        if ($input['tags'] !== []) {
            $lines[] = 'tagy:     '.implode(', ', $input['tags']);
        }

        // Existujúci uzol s tým istým menom = zlúčenie, nie nový uzol. Človek to
        // musí vidieť PRED potvrdením: „pridať" a „prepísať popis existujúceho"
        // sú dve rôzne rozhodnutia.
        $existing = $this->mind->findByLabel($input['label'], $input['type']);
        if ($existing) {
            $lines[0] = 'Zlúčenie s existujúcim uzlom #'.$existing->id.' („'.$existing->label.'“)';
        }

        $lines[] = '';
        $lines[] = $input['description'];

        return implode("\n", $lines);
    }

    public function execute(array $args): ToolResult
    {
        $input = $this->validated($args);

        $result = $this->mind->learn(
            type: $input['type'],
            label: $input['label'],
            description: $input['description'],
            areaName: $input['area'],
            departmentName: $input['department'],
            connections: [],
            sessionKey: null,
            certainty: $input['certainty'],
            tags: $input['tags'],
        );

        $node = $result['node'] ?? [];

        return ToolResult::json(array_filter([
            'action' => $result['action'] ?? 'created',
            'id' => $node['id'] ?? null,
            'label' => $node['label'] ?? $input['label'],
            'area' => $input['area'],
            'department_created' => $result['department_created'] ?? null,
        ], fn ($v) => $v !== null));
    }

    /**
     * Validácia, ktorá musí prebehnúť rovnako v `preview()` aj v `execute()` —
     * náhľad, ktorý ukáže niečo, čo sa potom odmietne, je horší než žiadny.
     *
     * @param  array<string, mixed>  $args
     * @return array{type: string, label: string, description: string, area: string, department: ?string, tags: array<int, string>, certainty: ?string}
     *
     * @throws ToolRefusal
     */
    private function validated(array $args): array
    {
        $type = strtolower($this->requiredString($args, 'type'));

        if (! in_array($type, ['skill', 'memory', 'project'], true)) {
            throw new ToolRefusal("Unknown `type`: {$type}. Use skill, memory or project.");
        }

        $label = $this->requiredString($args, 'label');
        $description = trim($this->requiredText($args, 'description'));
        $area = $this->requiredString($args, 'area');

        if ($description === '') {
            throw new ToolRefusal(
                'Refused: `description` is empty. A node without a description carries no knowledge — '
                .'write down what you actually learned, and why it matters.'
            );
        }

        // Serverová poistka blacklistu — tú istú, akú má MCP. Tajomstvo nesmie
        // skončiť v pamäti ani vtedy, keď ho človek omylom potvrdí.
        if ($this->secrets->looksLikeSecret($label) || $this->secrets->looksLikeSecret($description)) {
            throw new ToolRefusal(
                'Refused: the text looks like a password, API key or token. Those never go into the mind. '
                .'Describe what the secret is FOR, without the value.'
            );
        }

        // Ten istý klasifikátor, ktorým recall označuje existujúci odpad. Sonda
        // je neuložený Node — `noiseOf()` číta len label a popis, takže na to, aby
        // vyniesol rozsudok, nemusí uzol vzniknúť.
        $probe = new Node;
        $probe->label = $label;
        $probe->description = $description;

        if ($reason = $this->mind->noiseOf($probe)) {
            throw new ToolRefusal($this->refusalFor($reason, $label));
        }

        $certainty = $this->optionalString($args, 'certainty');

        if ($certainty !== null && ! in_array($certainty, ['overene', 'hypoteza', 'pasca'], true)) {
            throw new ToolRefusal("Unknown `certainty`: {$certainty}. Use overene, hypoteza or pasca.");
        }

        return [
            'type' => $type,
            'label' => $label,
            'description' => $description,
            'area' => $area,
            'department' => $this->optionalString($args, 'department'),
            'tags' => $this->stringList($args, 'tags'),
            'certainty' => $certainty,
        ];
    }

    /**
     * Odmietnutie musí modelu povedať, ČO urobiť inak — inak pošle to isté znova
     * a na CPU inferencii je každé kolo desiatky sekúnd.
     */
    private function refusalFor(string $reason, string $label): string
    {
        return match ($reason) {
            'markdown' => 'Refused: `label` contains markdown ('
                .'headings, bullets, ** or backticks). A label is a plain name — put the formatting, if you '
                .'need any, in `description`.',
            'raw-prompt' => 'Refused: `label` reads like a sentence from the conversation, not the name of a '
                .'piece of knowledge. Name the thing in 2-6 words (e.g. "Ollama na CPU bez GPU") and put the '
                .'sentence in `description`.',
            'slug' => 'Refused: `label` is a machine-generated slug. Use a name a human would recognise.',
            'stub' => 'Refused: `description` is too short (at least 15 characters of real explanation). '
                .'A node without knowledge in it only adds noise to recall.',
            default => "Refused: `label` looks like junk ({$reason}): {$label}",
        };
    }
}
