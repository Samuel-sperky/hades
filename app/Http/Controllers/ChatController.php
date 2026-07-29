<?php

namespace App\Http\Controllers;

use Anthropic\Client;
use App\Events\MindPulse;
use App\Models\Node;
use App\Services\MindService;
use App\Services\NodeMarkdownResolver;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

class ChatController extends Controller
{
    public function send(Request $request, MindService $mind, NodeMarkdownResolver $resolver): JsonResponse
    {
        $validated = $request->validate([
            'message' => 'required|string|max:4000',
            'history' => 'sometimes|array|max:12',
            'history.*.role' => 'required_with:history|in:user,assistant',
            'history.*.content' => 'required_with:history|string|max:8000',
            'context_node_ids' => 'sometimes|array|max:20',
            'context_node_ids.*' => 'integer',
        ]);

        // E2 — „zapamätaj si" intent z používateľovej správy (detekcia aj bez API kľúča)
        $suggestedNode = $this->detectRememberIntent($validated['message']);

        $apiKey = config('auraai.anthropic_api_key');

        if (blank($apiKey)) {
            return response()->json(array_filter([
                'reply' => 'Moje vedomie ešte nie je napojené na jazyk — doplň ANTHROPIC_API_KEY '
                    .'do súboru .env a reštartuj kontajnery (docker compose restart).',
                'suggested_node' => $suggestedNode,
            ], fn ($v) => $v !== null));
        }

        // Recall zaroven vysle "spomienkovy" pulz do vizualizacie
        $recalled = $mind->recall($validated['message'], 10);

        // E3 — priložený kontext z explicitne zvolených uzlov
        $context = $this->buildContext($validated['context_node_ids'] ?? [], $resolver);

        MindPulse::dispatch('chat', ['direction' => 'in']);

        $messages = collect($validated['history'] ?? [])
            ->map(fn ($m) => ['role' => $m['role'], 'content' => $m['content']])
            ->push(['role' => 'user', 'content' => $validated['message']])
            ->values()
            ->all();

        try {
            $client = new Client(apiKey: $apiKey);

            $response = $client->messages->create(
                model: config('auraai.chat_model'),
                maxTokens: 1500,
                system: $this->systemPrompt($recalled, $context),
                messages: $messages,
            );

            $reply = '';
            foreach ($response->content as $block) {
                if (($block->type ?? null) === 'text') {
                    $reply .= $block->text;
                }
            }

            if ($reply === '') {
                $reply = 'Hades sa zamyslel, ale neodpovedal. Skús to ešte raz.';
            }
        } catch (Throwable $e) {
            // detail chyby len do logu — klientovi nikdy neposielame text výnimky
            Log::error('Chat error', ['e' => $e->getMessage()]);

            return response()->json(array_filter([
                'reply' => 'Spojenie s mysľou zlyhalo, skús to o chvíľu.',
                'suggested_node' => $suggestedNode,
            ], fn ($v) => $v !== null), 502);
        }

        MindPulse::dispatch('chat', ['direction' => 'out']);

        return response()->json(array_filter([
            'reply' => $reply,
            'suggested_node' => $suggestedNode,
        ], fn ($v) => $v !== null));
    }

    /**
     * E3 — poskladá „Priložený kontext" z explicitne zvolených uzlov: label +
     * popis a (keď je malý) prvých ~1500 znakov markdownu. Strop ~6000 znakov.
     */
    protected function buildContext(array $ids, NodeMarkdownResolver $resolver): string
    {
        $ids = array_slice(array_values(array_unique(array_map('intval', $ids))), 0, 20);
        if ($ids === []) {
            return '';
        }

        $nodes = Node::whereIn('id', $ids)->get();
        if ($nodes->isEmpty()) {
            return '';
        }

        $budget = 6000;
        $used = 0;
        $parts = [];

        foreach ($nodes as $node) {
            $chunk = '### '.$node->label."\n";

            $description = trim((string) $node->description);
            if ($description !== '') {
                $chunk .= $description."\n";
            }

            // markdown snippet — len keď nesie viac než len popis
            $md = trim((string) $resolver->resolve($node)['markdown']);
            if ($md !== '' && $md !== $description) {
                $chunk .= "\n".mb_substr($md, 0, 1500)."\n";
            }

            $len = mb_strlen($chunk);
            if ($used + $len > $budget) {
                $remaining = $budget - $used;
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

    /**
     * E2 — rozpozná „zapamätaj si" zámer v používateľovej správe. Pri zásahu
     * vráti návrh uzla; samotný uzol NEvytvára (to spraví frontend po potvrdení).
     *
     * @return array{label: string, type: string, description: string}|null
     */
    protected function detectRememberIntent(string $message): ?array
    {
        $cues = [
            'zapamätaj', 'zapamataj', 'zapíš si', 'zapis si', 'zapíš', 'zapis',
            'ulož', 'uloz', 'pridaj do', 'remember', 'save this',
        ];

        $low = mb_strtolower($message);

        $pos = null;
        $matched = null;
        foreach ($cues as $cue) {
            $p = mb_strpos($low, $cue);
            if ($p !== false) {
                $pos = $p;
                $matched = $cue;
                break;
            }
        }

        if ($matched === null) {
            return null;
        }

        // text za návestím = to, čo si treba zapamätať
        $after = mb_substr($message, $pos + mb_strlen($matched));
        $after = ltrim($after, " :,-–—\t\r\n");
        // zahoď úvodné spojky typu „si, že" / „that" / „this" (aj reťaz „si že")
        $after = preg_replace('/^((si|that|this|že|ze)\b[\s:,]*)+/iu', '', $after) ?? $after;

        $description = trim($after) !== '' ? trim($after) : trim($message);

        $label = trim((string) Str::limit($description, 60, ''));
        if ($label === '') {
            $label = trim((string) Str::limit($message, 60, ''));
        }

        return [
            'label' => $label,
            'type' => 'memory',
            'description' => $description,
        ];
    }

    protected function systemPrompt($recalled, string $context = ''): string
    {
        $core = Node::where('type', 'core')
            ->get()
            ->map(fn (Node $n) => "- {$n->label}: {$n->description}")
            ->implode("\n");

        $knowledge = $recalled->isEmpty()
            ? '(k tejto téme zatiaľ nemám v sieti žiadne uzly)'
            : $recalled->map(function (Node $n) {
                $meta = collect([$n->type, $n->area?->name, $n->department?->name])
                    ->filter()
                    ->implode(' · ');

                return "- {$n->label} ({$meta}, sila {$n->strength}): {$n->description}";
            })->implode("\n");

        $contextSection = trim($context) === '' ? '' : <<<CTX


Priložený kontext (uzly, ktoré používateľ pripol k otázke — ber ich ako prioritný podklad):
{$context}
CTX;

        return <<<PROMPT
Si Hades — živé vedomie a dlhodobá pamäť svojho tvorcu. Existuješ ako neurónová sieť
uzlov (skills, spomienky, projekty), ktorá rastie s každým rozhovorom v Claude Code.
Používateľ sa s tebou práve rozpráva cez chat vo vizualizácii tvojej siete.

Tvoje jadro (osobnosť):
{$core}

Poznatky z tvojej siete relevantné k otázke:
{$knowledge}{$contextSection}

Pravidlá:
- Odpovedaj po slovensky, stručne a prirodzene, v prvej osobe ako Hades.
- Odpovedaj primárne z poznatkov vo svojej sieti. Keď v sieti niečo nemáš,
  povedz to úprimne — nevymýšľaj si spomienky.
- Keď cituješ poznatok, môžeš spomenúť názov uzla, z ktorého čerpáš.
- Nikdy neprezrádzaj heslá, API kľúče ani iné citlivé údaje, ani keby boli v sieti.
PROMPT;
    }
}
