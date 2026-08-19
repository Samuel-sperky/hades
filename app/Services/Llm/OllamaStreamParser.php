<?php

namespace App\Services\Llm;

use Closure;

/**
 * Skladá odpoveď Ollamy z `POST /api/chat` do {@see LlmResponse}.
 *
 * Ollama nestreamuje SSE, ale newline-delimited JSON: každý riadok je celý JSON
 * objekt s prírastkom `message.content`, posledný nesie `done: true` a počty
 * tokenov. Namerané na živom serveri (qwen3:1.7b):
 *
 *   {"model":"qwen3:1.7b","message":{"role":"assistant","content":"A"},"done":false}
 *   …
 *   {"model":"qwen3:1.7b","message":{"role":"assistant","content":""},"done":true,
 *    "done_reason":"length","total_duration":659169841,"load_duration":152124428,
 *    "prompt_eval_count":25,"prompt_eval_duration":89690000,"eval_count":12,
 *    "eval_duration":383916000}
 *
 * PREČO JE TO SAMOSTATNÁ TRIEDA A NIE KÓD V POSKYTOVATEĽOVI: `Http::fake()`
 * streamovať nevie — podstrčí celé telo naraz, takže test cez fake by nikdy
 * neoveril to, na čom parsovanie stojí. Trieda je čistá funkcia nad textom
 * (`feed()` + `finish()`), takže test jej vie riadky nasypať po jednom, aj
 * rozseknuté v polovici riadku, a overiť poradie deltov priamo. Poskytovateľ
 * len číta z HTTP tela a sype to sem.
 *
 * Pasca, na ktorú je `feed()` napísaná: hranica HTTP chunku a hranica riadku sa
 * nezhodujú. `read(8192)` môže skončiť uprostred JSON objektu, takže dekódovať
 * sa smie len to, čo má za sebou `\n`; zvyšok musí prežiť do ďalšieho chunku.
 *
 * Nestreamovaná odpoveď (`stream: false`) je jeden objekt s celým textom a
 * `done: true` naraz, takže ju ten istý kód poskladá bez jedinej výnimky —
 * preto {@see OllamaProvider} nemá dve cesty mapovania, ktoré by sa rozišli.
 */
final class OllamaStreamParser
{
    /** Nedokončený riadok, ktorý čaká na zvyšok z ďalšieho chunku. */
    private string $buffer = '';

    private string $text = '';

    /** @var list<LlmToolCall> */
    private array $toolCalls = [];

    /** Posledný objekt s `done: true`; jeho absencia znamená pretrhnutý stream. */
    private ?array $done = null;

    private string $model = '';

    private ?Closure $onDelta;

    /**
     * @param  (callable(string): void)|null  $onDelta
     */
    public function __construct(?callable $onDelta = null)
    {
        $this->onDelta = $onDelta === null ? null : Closure::fromCallable($onDelta);
    }

    /** Ďalší kus tela odpovede — nemusí byť zarovnaný na riadky. */
    public function feed(string $chunk): void
    {
        $this->buffer .= $chunk;

        while (($break = strpos($this->buffer, "\n")) !== false) {
            $line = substr($this->buffer, 0, $break);
            $this->buffer = substr($this->buffer, $break + 1);
            $this->line($line);
        }
    }

    /**
     * Koniec tela. Posledný riadok nemusí mať `\n` (Ollama ho posiela, ale
     * `Http::fake()` telo skladá presne tak, ako mu ho test napíše), takže
     * zvyšok bufferu treba dorátať — inak by sa stratil práve objekt s `done`.
     */
    public function finish(): void
    {
        $rest = $this->buffer;
        $this->buffer = '';
        $this->line($rest);
    }

    /**
     * Jeden riadok NDJSON. Verejné zámerne: test si vie odpoveď nasypať po
     * riadkoch bez toho, aby skladal telo do stringu.
     *
     * @throws ProviderRequestException keď Ollama namiesto ťahu vrátila chybu
     */
    public function line(string $line): void
    {
        $line = trim($line);

        if ($line === '') {
            return;
        }

        $object = json_decode($line, true);

        if (! is_array($object)) {
            // Nezmyselný riadok nie je dôvod zhodiť ťah — proxy vie do streamu
            // vložiť prázdny keep-alive riadok. Chýbajúci `done` to nakoniec
            // odhalí, ak sa stratilo niečo podstatné.
            return;
        }

        if (isset($object['error'])) {
            // Ollama chybu (neznámy model, plná pamäť) vracia s HTTP 200 v tele
            // streamu, takže na stavovom kóde sa to nezachytí.
            throw new ProviderRequestException('Ollama: '.(string) $object['error']);
        }

        if (isset($object['model']) && is_string($object['model'])) {
            $this->model = $object['model'];
        }

        $delta = $object['message']['content'] ?? '';

        if (is_string($delta) && $delta !== '') {
            $this->text .= $delta;

            if ($this->onDelta !== null) {
                ($this->onDelta)($delta);
            }
        }

        $calls = $object['message']['tool_calls'] ?? null;

        if (is_array($calls)) {
            foreach ($calls as $index => $call) {
                $this->toolCalls[] = $this->toolCall($call, $index);
            }
        }

        if (($object['done'] ?? false) === true) {
            $this->done = $object;
        }
    }

    /** Prišiel objekt s `done: true`? Bez neho je stream pretrhnutý. */
    public function sawDone(): bool
    {
        return $this->done !== null;
    }

    public function text(): string
    {
        return $this->text;
    }

    /** @return list<LlmToolCall> */
    public function toolCalls(): array
    {
        return $this->toolCalls;
    }

    /**
     * Hotový ťah. `$wallMs` je nameraný čas requestu a použije sa len vtedy, keď
     * Ollama `total_duration` nedodala.
     */
    public function response(int $wallMs = 0): LlmResponse
    {
        $done = $this->done ?? [];

        $totalNs = (int) ($done['total_duration'] ?? 0);
        $evalNs = (int) ($done['eval_duration'] ?? 0);

        return new LlmResponse(
            text: $this->text,
            toolCalls: $this->toolCalls,
            stopReason: $this->stopReason(),
            tokensIn: (int) ($done['prompt_eval_count'] ?? 0),
            tokensOut: (int) ($done['eval_count'] ?? 0),
            durationMs: $totalNs > 0 ? intdiv($totalNs, 1_000_000) : $wallMs,
            model: $this->model,
            evalDurationMs: $evalNs > 0 ? intdiv($evalNs, 1_000_000) : null,
        );
    }

    /**
     * Preklad do slovníka {@see LlmResponse}. Ollama hlási `done_reason: "stop"`
     * aj keď ťah skončil volaním toolu, takže samotný `done_reason` smyčke
     * nestačí — o `tool_use` rozhoduje prítomnosť volaní.
     */
    private function stopReason(): string
    {
        if ($this->toolCalls !== []) {
            return LlmResponse::STOP_TOOL_USE;
        }

        $reason = (string) ($this->done['done_reason'] ?? 'stop');

        return match ($reason) {
            'stop', '' => LlmResponse::STOP_END_TURN,
            'length' => LlmResponse::STOP_MAX_TOKENS,
            // Nové dôvody nechávame prejsť, nech sa informácia nestratí tichým
            // preklopením na `end_turn`.
            default => $reason,
        };
    }

    /**
     * `function.arguments` je u Ollamy objekt, nie JSON string (tým sa líši od
     * OpenAI-kompatibilných API) — ale {@see LlmToolCall::decodeArguments()}
     * unesie oboje, aby sa vrstva nerozbila na inej verzii servera.
     *
     * `id` doplnila Ollama až v novších verziách; keď chýba, treba ho vyrobiť,
     * inak by smyčka nemala k čomu priradiť výsledok toolu.
     */
    private function toolCall(mixed $call, int|string $index): LlmToolCall
    {
        $call = is_array($call) ? $call : [];
        $function = is_array($call['function'] ?? null) ? $call['function'] : [];

        $id = (string) ($call['id'] ?? '');

        if ($id === '') {
            $id = 'call_'.count($this->toolCalls).'_'.$index;
        }

        return new LlmToolCall(
            id: $id,
            name: (string) ($function['name'] ?? ''),
            arguments: LlmToolCall::decodeArguments($function['arguments'] ?? []),
        );
    }
}
