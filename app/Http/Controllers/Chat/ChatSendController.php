<?php

namespace App\Http\Controllers\Chat;

use App\Events\MindPulse;
use App\Http\Controllers\Controller;
use App\Models\Node;
use App\Services\Chat\ChatPipeline;
use App\Services\Chat\ConversationStore;
use App\Services\Chat\NodeContextBuilder;
use App\Services\Chat\RememberIntentDetector;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * `POST /api/chat` — nestreamovaná odpoveď. Vlastník P5, klient P6.
 *
 * KONTRAKT: vždy HTTP 200 s odpoveďou z vrstvy 1+3, aj keď Ollama nebeží
 * (rozhodnutie #119). Nikdy 500, nikdy prázdny stav. Nedostupný model sa hlási
 * v `meta.degraded` + `meta.reason`, nie stavovým kódom.
 *
 * Spätná kompatibilita s dnešným frontendom: kľúče `reply` a `suggested_node`
 * zostávajú, ostatné sú aditívne.
 */
final class ChatSendController extends Controller
{
    public function __invoke(
        Request $request,
        ChatPipeline $pipeline,
        ConversationStore $store,
        NodeContextBuilder $contextBuilder,
        RememberIntentDetector $remember,
    ): JsonResponse {
        $validated = $request->validate([
            'message' => 'required|string|max:4000',
            'conversation_id' => 'sometimes|nullable|integer',
            'history' => 'sometimes|array|max:12',
            'history.*.role' => 'required_with:history|in:user,assistant',
            'history.*.content' => 'required_with:history|string|max:8000',
            'context_node_ids' => 'sometimes|array|max:20',
            'context_node_ids.*' => 'integer',
            'model' => 'sometimes|nullable|string|max:64',
        ]);

        $message = trim((string) $validated['message']);

        // Detekcia zámeru zapamätania beží aj bez modelu; uzol sa NEVYTVÁRA,
        // potvrdzuje ho frontend kartou „Zapamätať" (rozhodnutie #94).
        $suggestedNode = $remember->detect($message);

        $conversation = $store->resolve(
            isset($validated['conversation_id']) ? (int) $validated['conversation_id'] : null,
        );
        $store->appendUser($conversation, $message);

        MindPulse::dispatch('chat', ['direction' => 'in']);

        $context = $contextBuilder->build($validated['context_node_ids'] ?? []);
        $history = $store->historyFor($conversation);
        // Poslednou položkou histórie je práve uložená otázka — do promptu ide zvlášť.
        array_pop($history);

        $answer = $pipeline->answer(
            message: $message,
            context: $context,
            sessionKey: $this->sessionKey($conversation->id),
            history: $history,
        );

        $stored = $store->appendAnswer($conversation, $answer);

        MindPulse::dispatch('chat', ['direction' => 'out']);

        return response()->json(array_filter([
            'reply' => $answer->text,
            'suggested_node' => $suggestedNode,
            'conversation_id' => $conversation->id,
            'conversation_title' => $conversation->fresh()?->displayTitle(),
            'message_id' => $stored->id,
            'cited_node_ids' => $answer->citations,
            'citations' => self::citations($answer->citations),
            'meta' => $answer->meta(),
        ], fn ($value) => $value !== null));
    }

    /**
     * „Vychádzal som z:" — uzly s labelom, aby klient nemusel dopytovať znovu
     * (rozhodnutie #96). Poradie sa zachováva podľa relevancie.
     *
     * @param  list<int>  $ids
     * @return list<array<string, mixed>>
     */
    public static function citations(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $nodes = Node::query()
            ->with(['area'])
            ->whereIn('id', $ids)
            ->get()
            ->keyBy('id');

        $out = [];
        foreach ($ids as $id) {
            $node = $nodes->get($id);
            if ($node instanceof Node) {
                $out[] = [
                    'id' => $node->id,
                    'label' => $node->label,
                    'type' => $node->type,
                    'area' => $node->area?->name,
                ];
            }
        }

        return $out;
    }

    /** Aktivácie z jedného vlákna sa majú v grafe pospájať (co-activation). */
    private function sessionKey(int $conversationId): string
    {
        return 'chat-'.$conversationId;
    }
}
