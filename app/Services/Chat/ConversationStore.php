<?php

namespace App\Services\Chat;

use App\Llm\ChatOptions;
use App\Llm\ProviderFactory;
use App\Models\Conversation;
use App\Models\Message;
use App\Services\Brain\SecretScanner;
use Illuminate\Support\Str;
use Throwable;

/**
 * Perzistencia histórie chatu (rozhranie #18, rozhodnutie #89). Vlastník P5.
 *
 * Dnes je história pole v pamäti prehliadača a po reloade zmizne. Odteraz je
 * v MariaDB, takže prežije reload aj prepnutie režimu (overlay ↔ obrazovka).
 *
 * Auto-názov vlákna: model NAVRHNE, tento kód ROZHODNE (rozhodnutie #112/#128).
 * Bez Ollamy je názov bit-identický s heuristikou.
 */
final class ConversationStore
{
    /** Koľko posledných správ ide do promptu modelu. */
    private const HISTORY_WINDOW = 12;

    public function __construct(
        private readonly ProviderFactory $providers,
        private readonly SecretScanner $scanner,
        private readonly RephraseValidator $validator,
    ) {}

    /** Existujúce vlákno alebo nové. Neznáme id nikdy nespôsobí chybu. */
    public function resolve(?int $conversationId): Conversation
    {
        if ($conversationId !== null) {
            $existing = Conversation::find($conversationId);
            if ($existing instanceof Conversation) {
                return $existing;
            }
        }

        return Conversation::create(['last_message_at' => now()]);
    }

    public function appendUser(Conversation $conversation, string $content): Message
    {
        $message = $conversation->messages()->create([
            'role' => 'user',
            'content' => $content,
            'created_at' => now(),
        ]);

        $conversation->forceFill(['last_message_at' => now()])->save();

        // Názov sa dopĺňa až z PRVEJ používateľskej správy.
        if (trim((string) $conversation->title) === '') {
            $title = $this->smartTitle($content);
            if ($title !== '') {
                $conversation->forceFill(['title' => $title])->save();
            }
        }

        return $message;
    }

    public function appendAnswer(Conversation $conversation, ChatAnswer $answer, int $promptTokens = 0, int $completionTokens = 0): Message
    {
        $meta = $answer->meta();

        $message = $conversation->messages()->create([
            'role' => 'assistant',
            'content' => $answer->text,
            'model' => $answer->model,
            'tokens_in' => $promptTokens,
            'tokens_out' => $completionTokens,
            'ms' => $answer->ms,
            'cited_node_ids' => $answer->citations,
            'meta' => $meta,
            'created_at' => now(),
        ]);

        $conversation->forceFill(['last_message_at' => now()])->save();

        return $message;
    }

    /**
     * Posledných N správ vlákna ako `messages` pre providera.
     *
     * @return list<array{role: string, content: string}>
     */
    public function historyFor(Conversation $conversation, int $limit = self::HISTORY_WINDOW): array
    {
        return $conversation->messages()
            ->whereIn('role', ['user', 'assistant'])
            ->orderByDesc('id')
            ->limit($limit)
            ->get()
            ->reverse()
            ->map(fn (Message $m) => ['role' => $m->role, 'content' => $m->content])
            ->values()
            ->all();
    }

    /**
     * Auto-názov: návrh modelu → validácia → heuristika.
     * Prázdny výsledok nikdy nevzniká, keď je vstup neprázdny.
     */
    public function smartTitle(string $firstMessage): string
    {
        $heuristic = $this->heuristicTitle($firstMessage);

        try {
            $result = $this->providers->forChat()->chat(
                [['role' => 'user', 'content' => $this->scanner->redact($firstMessage)]],
                new ChatOptions(
                    system: (string) config('prompts.system.title', ''),
                    timeoutMs: 20_000,
                    task: 'title',
                ),
            );

            if ($result->ok()) {
                $suggested = ModelText::extract($result->text);
                if (is_string($suggested)) {
                    // Titulok smie čísla vypustiť, ale nesmie žiadne pridať.
                    $clean = $this->validator->validateTitle($firstMessage, $this->cleanTitle($suggested));
                    if (is_string($clean) && $clean !== '') {
                        return $clean;
                    }
                }
            }
        } catch (Throwable) {
            // Model je nadstavba — jeho zlyhanie nikdy neblokuje uloženie vlákna.
        }

        return $heuristic;
    }

    private function heuristicTitle(string $message): string
    {
        $text = trim(preg_replace('/\s+/u', ' ', $message) ?? $message);
        if ($text === '') {
            return '';
        }

        // Prvá veta, inak prvých 60 znakov.
        $sentence = preg_split('/(?<=[\.\?\!])\s/u', $text)[0] ?? $text;

        return $this->cleanTitle((string) Str::limit(trim($sentence), 60, ''));
    }

    private function cleanTitle(string $title): string
    {
        $title = trim(preg_replace('/\s+/u', ' ', $title) ?? $title);
        $title = trim($title, " \t\n\r\0\x0B\"'`«»„“”.");

        return (string) Str::limit($title, 60, '');
    }
}
