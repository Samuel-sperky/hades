<?php

namespace App\Http\Controllers\Chat;

use App\Http\Controllers\Controller;
use App\Models\Conversation;
use App\Models\Message;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Vlákna chatu — zoznam, obsah, prepnutie názvu a export do Markdownu.
 * Vlastník P5, klient P6.
 *
 * Mazanie vlákna tu ZÁMERNE nie je: deštruktívne operácie nad dátami sa
 * v tomto sprinte nezapínajú (§6 kontraktu). Doplní sa samostatne, so zálohou
 * a potvrdením používateľa.
 */
final class ConversationController extends Controller
{
    /** Zoznam vlákien, najnovšie prvé. */
    public function index(): JsonResponse
    {
        $conversations = Conversation::query()
            ->withCount('messages')
            ->orderByDesc('last_message_at')
            ->orderByDesc('id')
            ->limit(50)
            ->get();

        return response()->json([
            'conversations' => $conversations->map(fn (Conversation $c) => $c->toApi())->values()->all(),
        ]);
    }

    /** Obsah vlákna — história prežije reload prehliadača (rozhodnutie #89). */
    public function show(Conversation $conversation): JsonResponse
    {
        return response()->json([
            'conversation' => $conversation->toApi(),
            'messages' => $conversation->messages->map(fn (Message $m) => $m->toApi())->values()->all(),
        ]);
    }

    /** Nové prázdne vlákno — „nový rozhovor" v UI. */
    public function store(): JsonResponse
    {
        $conversation = Conversation::create(['last_message_at' => now()]);

        return response()->json(['conversation' => $conversation->toApi()], 201);
    }

    /** Premenovanie vlákna. */
    public function update(Request $request, Conversation $conversation): JsonResponse
    {
        $validated = $request->validate([
            'title' => 'required|string|max:120',
        ]);

        $conversation->forceFill(['title' => trim($validated['title'])])->save();

        return response()->json(['conversation' => $conversation->fresh()?->toApi()]);
    }

    /** Export do Markdownu (rozhodnutie #100) — text vracia klientovi, nikam nezapisuje. */
    public function export(Conversation $conversation): JsonResponse
    {
        $conversation->load('messages');

        return response()->json([
            'filename' => 'auraai-chat-'.$conversation->id.'.md',
            'markdown' => $conversation->toMarkdown(),
        ]);
    }
}
