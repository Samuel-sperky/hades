<?php

namespace App\Http\Controllers\Chat;

use App\Events\MindPulse;
use App\Http\Controllers\Controller;
use App\Services\Chat\ChatPipeline;
use App\Services\Chat\ConversationStore;
use App\Services\Chat\NodeContextBuilder;
use App\Services\Chat\RememberIntentDetector;
use App\Services\Chat\StreamGate;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Throwable;

/**
 * `POST /api/chat/stream` — SSE. ZAMKNUTÉ ROZHRANIE #17 (server P5, klient P6).
 *
 * Vstup: `{message, conversation_id, context_node_ids, model?}`
 * Udalosti: `token` · `meta` · `citations` · `done` · `error`
 *
 * PREČO SSE A NIE REVERB (zdôvodnenie vyžiadané zadaním):
 *   1. Rozhranie #17 je ZAMKNUTÉ a klient P6 sa stavia proti nemu súbežne;
 *      prehodenie na WebSocket by znamenalo zmenu kontraktu v cudzom balíku.
 *   2. Reverb kanál `mind` (po rebrande `aura`) je PUBLIC a bez autorizácie —
 *      tokeny konverzácie by sa vysielali každému otvorenému prehliadaču.
 *      To je únik obsahu, nie detail. Privátne kanály by znamenali auth vrstvu,
 *      ktorú appka nemá.
 *   3. Riziko `artisan serve` (8 workerov, SSE drží workera celý stream) je
 *      reálne, ale rieši sa v tomto balíku bez zmeny infra: StreamGate drží
 *      `llm.max_concurrent_streams` (default 1) slotov, takže streamy nikdy
 *      neobsadia viac než jedného workera. Druhá požiadavka dostane
 *      `meta {queued:true}` a po vypršaní čakania odpoveď z vrstiev 1+3
 *      (deterministickú, okamžitú) — nikdy chybu.
 *   4. Systémová oprava zostáva prechod na FrankenPHP/Octane (rozhodnutie #27) —
 *      `docker/php/Dockerfile` a `docker-compose.yml` sú súbory integrátora,
 *      preto je patch v reporte P5 a nie v tomto balíku.
 */
final class ChatStreamController extends Controller
{
    public function __invoke(
        Request $request,
        ChatPipeline $pipeline,
        ConversationStore $store,
        NodeContextBuilder $contextBuilder,
        RememberIntentDetector $remember,
        StreamGate $gate,
    ): StreamedResponse {
        $validated = $request->validate([
            'message' => 'required|string|max:4000',
            'conversation_id' => 'sometimes|nullable|integer',
            'context_node_ids' => 'sometimes|array|max:20',
            'context_node_ids.*' => 'integer',
            'model' => 'sometimes|nullable|string|max:64',
        ]);

        $message = trim((string) $validated['message']);
        $contextIds = $validated['context_node_ids'] ?? [];
        $suggestedNode = $remember->detect($message);

        $conversation = $store->resolve(
            isset($validated['conversation_id']) ? (int) $validated['conversation_id'] : null,
        );
        $store->appendUser($conversation, $message);

        $response = new StreamedResponse(function () use (
            $pipeline, $store, $contextBuilder, $gate,
            $conversation, $message, $contextIds, $suggestedNode,
        ): void {
            try {
                // Slot streamu — chráni workery `artisan serve` (rozhodnutie #126).
                $allowModel = $gate->tryAcquire();

                $this->send('meta', [
                    'conversation_id' => $conversation->id,
                    'conversation_title' => $conversation->fresh()?->displayTitle(),
                    'queued' => ! $allowModel,
                    'notice' => $allowModel ? null : 'Odpovedám hneď z pamäte — model je práve zaneprázdnený.',
                    'suggested_node' => $suggestedNode,
                ]);

                if (! $allowModel) {
                    $allowModel = $gate->waitForSlot();
                }

                MindPulse::dispatch('chat', ['direction' => 'in']);

                $context = $contextBuilder->build($contextIds);
                $history = $store->historyFor($conversation);
                array_pop($history);

                $answer = $pipeline->stream(
                    message: $message,
                    onToken: fn (string $text) => $this->send('token', ['text' => $text]),
                    context: $context,
                    sessionKey: 'chat-'.$conversation->id,
                    history: $history,
                    allowModel: $allowModel,
                );

                $stored = $store->appendAnswer($conversation, $answer);

                if ($answer->citations !== []) {
                    $this->send('citations', ['nodes' => ChatSendController::citations($answer->citations)]);
                }

                MindPulse::dispatch('chat', ['direction' => 'out']);

                $this->send('done', [
                    'conversation_id' => $conversation->id,
                    'message_id' => $stored->id,
                    'cited_node_ids' => $answer->citations,
                    'meta' => $answer->meta() + ['stream_queued' => ! $allowModel],
                ]);
            } catch (Throwable $e) {
                report($e);
                // Text výnimky sa klientovi nikdy neposiela.
                $this->send('error', ['message' => 'Odpoveď sa nepodarilo doručiť. Skús to znovu.']);
            } finally {
                $gate->release();
            }
        });

        $response->headers->set('Content-Type', 'text/event-stream');
        $response->headers->set('Cache-Control', 'no-cache, no-transform');
        $response->headers->set('Connection', 'keep-alive');
        // Caddy/nginx nesmú stream bufferovať, inak klient nevidí nič do konca.
        $response->headers->set('X-Accel-Buffering', 'no');

        return $response;
    }

    /** @param  array<string, mixed>  $payload */
    private function send(string $event, array $payload): void
    {
        echo 'event: '.$event."\n";
        echo 'data: '.json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n\n";

        // Bez vyprázdnenia bufferov by tokeny prišli až na konci streamu.
        if (ob_get_level() > 0) {
            @ob_flush();
        }
        flush();
    }
}
