<?php

namespace App\Http\Controllers\Console;

use App\Http\Controllers\Controller;
use App\Models\ConsoleThread;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Vlákna konzoly — zoznam, založenie, načítanie, prepnutie modelu, zmazanie.
 *
 * Celý okruh sedí za `auth.ui` + CSRF (§3.3 docs/BEZPECNOST.md) rovnako ako
 * ostatné interné `/api/*`. Vlákno nesie históriu agentového behu vrátane
 * výsledkov toolov, takže čítanie vlákna je čítaním pamäte — nie menej citlivé
 * než `GET /api/mind`.
 */
class ThreadController extends Controller
{
    /** Zoznam pre bočný panel — bez správ, len to, čo sa vypisuje v riadku. */
    public function index(): JsonResponse
    {
        $threads = ConsoleThread::query()
            ->orderByDesc('last_message_at')
            ->orderByDesc('id')
            ->limit(100)
            ->get(['uuid', 'title', 'provider', 'model', 'auto_accept', 'last_message_at'])
            ->map(fn (ConsoleThread $t) => [
                'uuid' => $t->uuid,
                'title' => $t->title ?? 'Nové vlákno',
                'provider' => $t->provider,
                'model' => $t->model,
                'auto_accept' => $t->auto_accept,
                'last_message_at' => $t->last_message_at?->toIso8601String(),
            ]);

        return response()->json(['threads' => $threads]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'provider' => 'sometimes|string|in:ollama,anthropic',
            'model' => 'sometimes|nullable|string|max:120',
            'title' => 'sometimes|nullable|string|max:200',
        ]);

        $thread = ConsoleThread::create([
            'provider' => $data['provider'] ?? config('hades.console.provider'),
            'model' => $data['model'] ?? null,
            'title' => $data['title'] ?? null,
        ]);

        return response()->json($this->payload($thread), 201);
    }

    public function show(ConsoleThread $thread): JsonResponse
    {
        return response()->json($this->payload($thread));
    }

    /** Prepnutie modelu / poskytovateľa a „auto-accept" na sedenie. */
    public function update(Request $request, ConsoleThread $thread): JsonResponse
    {
        $data = $request->validate([
            'provider' => 'sometimes|string|in:ollama,anthropic',
            'model' => 'sometimes|nullable|string|max:120',
            'title' => 'sometimes|nullable|string|max:200',
            'auto_accept' => 'sometimes|boolean',
        ]);

        $thread->fill($data)->save();

        return response()->json($this->payload($thread));
    }

    public function destroy(ConsoleThread $thread): JsonResponse
    {
        // správy aj tool cally idú s vláknom (cascadeOnDelete) — vlákno bez nich
        // by bola len prázdna hlavička v paneli
        $thread->delete();

        return response()->json(['deleted' => true]);
    }

    /** Vlákno s celou históriou — presne to, čo konzola potrebuje na obnovu. */
    private function payload(ConsoleThread $thread): array
    {
        $thread->load(['messages' => fn ($q) => $q->orderBy('id'), 'toolCalls' => fn ($q) => $q->orderBy('id')]);

        return [
            'uuid' => $thread->uuid,
            'title' => $thread->title ?? 'Nové vlákno',
            'provider' => $thread->provider,
            'model' => $thread->model,
            'auto_accept' => $thread->auto_accept,
            'messages' => $thread->messages->map(fn ($m) => array_filter([
                'id' => $m->id,
                'role' => $m->role,
                'content' => $m->content,
                'model' => $m->model,
                'stop_reason' => $m->stop_reason,
                'tokens_out' => $m->tokens_out,
                'tokens_per_second' => $m->tokensPerSecond(),
            ], fn ($v) => $v !== null))->all(),
            'tool_calls' => $thread->toolCalls->map(fn ($c) => array_filter([
                'id' => $c->id,
                'message_id' => $c->message_id,
                'name' => $c->name,
                'arguments' => $c->arguments,
                'status' => $c->status,
                'result' => $c->result,
                'error' => $c->error,
                'preview' => $c->preview,
                'duration_ms' => $c->duration_ms,
            ], fn ($v) => $v !== null))->all(),
            // beh, ktorý čaká na rozhodnutie — klient podľa toho vykreslí prompt
            'awaiting' => $thread->pendingToolCall()?->id,
        ];
    }
}
