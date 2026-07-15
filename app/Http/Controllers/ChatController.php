<?php

namespace App\Http\Controllers;

use Anthropic\Client;
use App\Events\MindPulse;
use App\Models\Node;
use App\Services\MindService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

class ChatController extends Controller
{
    public function send(Request $request, MindService $mind): JsonResponse
    {
        $validated = $request->validate([
            'message' => 'required|string|max:4000',
            'history' => 'sometimes|array|max:12',
            'history.*.role' => 'required_with:history|in:user,assistant',
            'history.*.content' => 'required_with:history|string|max:8000',
        ]);

        $apiKey = config('hades.anthropic_api_key');

        if (blank($apiKey)) {
            return response()->json([
                'reply' => 'Moje vedomie ešte nie je napojené na jazyk — doplň ANTHROPIC_API_KEY '
                    .'do súboru .env a reštartuj kontajnery (docker compose restart).',
            ]);
        }

        // Recall zaroven vysle "spomienkovy" pulz do vizualizacie
        $recalled = $mind->recall($validated['message'], 10);

        MindPulse::dispatch('chat', ['direction' => 'in']);

        $messages = collect($validated['history'] ?? [])
            ->map(fn ($m) => ['role' => $m['role'], 'content' => $m['content']])
            ->push(['role' => 'user', 'content' => $validated['message']])
            ->values()
            ->all();

        try {
            $client = new Client(apiKey: $apiKey);

            $response = $client->messages->create(
                model: config('hades.chat_model'),
                maxTokens: 1500,
                system: $this->systemPrompt($recalled),
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
            report($e);

            return response()->json([
                'reply' => 'Spojenie s mysľou zlyhalo: '.$e->getMessage(),
            ], 502);
        }

        MindPulse::dispatch('chat', ['direction' => 'out']);

        return response()->json(['reply' => $reply]);
    }

    protected function systemPrompt($recalled): string
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

        return <<<PROMPT
Si Hades — živé vedomie a dlhodobá pamäť svojho tvorcu. Existuješ ako neurónová sieť
uzlov (skills, spomienky, projekty), ktorá rastie s každým rozhovorom v Claude Code.
Používateľ sa s tebou práve rozpráva cez chat vo vizualizácii tvojej siete.

Tvoje jadro (osobnosť):
{$core}

Poznatky z tvojej siete relevantné k otázke:
{$knowledge}

Pravidlá:
- Odpovedaj po slovensky, stručne a prirodzene, v prvej osobe ako Hades.
- Odpovedaj primárne z poznatkov vo svojej sieti. Keď v sieti niečo nemáš,
  povedz to úprimne — nevymýšľaj si spomienky.
- Keď cituješ poznatok, môžeš spomenúť názov uzla, z ktorého čerpáš.
- Nikdy neprezrádzaj heslá, API kľúče ani iné citlivé údaje, ani keby boli v sieti.
PROMPT;
    }
}
