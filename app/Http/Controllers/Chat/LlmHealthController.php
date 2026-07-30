<?php

namespace App\Http\Controllers\Chat;

use App\Http\Controllers\Controller;
use App\Llm\ProviderFactory;
use App\Models\LlmRun;
use Illuminate\Http\JsonResponse;

/**
 * `GET /api/chat/health` — stav lokálneho modelu pre UI. Vlastník P5, klient P6.
 *
 * Slúži na: diskrétny stav „lokálny model nedostupný" (rozhodnutie #119),
 * prepínač modelu v chate a slash príkaz `/model` (rozhodnutie #121) a
 * mikro-label s tok/s (rozhodnutie #120).
 *
 * Vždy HTTP 200 — nedostupná Ollama nie je chyba API.
 */
final class LlmHealthController extends Controller
{
    public function __invoke(ProviderFactory $providers): JsonResponse
    {
        $provider = $providers->forChat();
        $health = $provider->health();

        return response()->json([
            'provider' => $provider->name(),
            'ok' => $health->ok,
            'chat' => $health->chat,
            'embed' => $health->embed,
            'models' => $health->models,
            'latency_ms' => $health->latencyMs,
            'error' => $health->error,
            'degraded' => ! $health->chat,
            'degraded_notice' => (string) config('prompts.degraded_notice'),
            'defaults' => [
                'router' => (string) config('llm.models.router'),
                'escalation' => (string) config('llm.models.escalation'),
                'embed' => (string) config('llm.models.embed'),
            ],
            'last_runs' => LlmRun::query()
                ->orderByDesc('id')
                ->limit(5)
                ->get()
                ->map(fn (LlmRun $run) => $run->toApi())
                ->values()
                ->all(),
        ]);
    }
}
