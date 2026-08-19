<?php

namespace App\Services\Llm;

use Anthropic\Client;
use Anthropic\Lib\Streaming\MessageAccumulator;
use Anthropic\Messages\Model;
use App\Http\Controllers\ChatController;
use JsonSerializable;
use Throwable;

/**
 * Claude cez oficiálne PHP SDK — ten istý kontrakt ako lokálny model.
 *
 * SDK sa používa presne tak, ako ho volá {@see ChatController}
 * (`$client->messages->create(…)`), len s pridanými toolmi a streamovaním.
 *
 * Bez kľúča je `available()` false a `chat()` hodí {@see ProviderUnavailableException}.
 * Prečo nie surová chyba zo SDK: prázdny `ANTHROPIC_API_KEY` je dnes bežný stav
 * (chat vo vizualizácii je preto mŕtvy) a konzola musí vedieť rozdiel medzi
 * „nie je nastavené“ a „request zlyhal“, aby vedela, či má ponúknuť návod alebo
 * opakovanie.
 */
class AnthropicProvider implements LlmProvider
{
    public const NAME = 'anthropic';

    /** Strop na výstup jedného ťahu, keď ho volajúci nezadal. */
    private const MAX_TOKENS = 4096;

    public function name(): string
    {
        return self::NAME;
    }

    public function available(): bool
    {
        return $this->apiKey() !== '';
    }

    /**
     * Prečo statický zoznam a nie `GET /v1/models`: bez kľúča sa nedá zavolať,
     * a práve bez kľúča konzola tento zoznam potrebuje — na vykreslenie ponuky
     * ešte pred nastavením. Zoznam sa preto číta z enumu v SDK, nie z ručne
     * prepísanej konštanty: pri `composer update` sa obnoví sám a nezostarne.
     *
     * Bedrock a Vertex identifikátory sú z toho istého enumu odfiltrované —
     * tento poskytovateľ hovorí priamo s Anthropic API a tie by sa nezavolali.
     */
    public function models(): array
    {
        $models = [];

        foreach (Model::cases() as $case) {
            $id = $case->value;

            if (str_starts_with($id, 'claude-') && ! str_contains($id, '@')) {
                $models[] = $id;
            }
        }

        return $models;
    }

    public function chat(array $messages, array $options = []): LlmResponse
    {
        $client = $this->client();
        $arguments = $this->arguments($messages, $options);
        $startedAt = hrtime(true);

        try {
            $message = $client->messages->create(...$arguments);
        } catch (Throwable $e) {
            throw ProviderRequestException::from(self::NAME, $e);
        }

        return self::normalise(self::wireShape($message), $this->elapsedMs($startedAt));
    }

    public function stream(array $messages, array $options, callable $onDelta): LlmResponse
    {
        $client = $this->client();
        $arguments = $this->arguments($messages, $options);
        $accumulator = MessageAccumulator::forMessages();
        $startedAt = hrtime(true);

        try {
            foreach ($client->messages->createStream(...$arguments) as $event) {
                // Akumulátor zo SDK zloží z udalostí ten istý `Message`, aký by
                // prišiel z `create()`, takže mapovanie je jedno pre oba ťahy.
                $accumulator->accumulate($event);

                $delta = self::textDelta(self::wireShape($event));

                if ($delta !== '') {
                    $onDelta($delta);
                }
            }

            $message = $accumulator->message();
        } catch (Throwable $e) {
            throw ProviderRequestException::from(self::NAME, $e);
        }

        return self::normalise(self::wireShape($message), $this->elapsedMs($startedAt));
    }

    /**
     * Odpoveď Anthropicu (v drôtovom tvare) → {@see LlmResponse}.
     *
     * Verejné a statické zámerne: je to čistá funkcia nad polom, takže sa dá
     * otestovať bez SDK a bez siete — a práve tu sa overuje, že tool call z
     * Claude vyjde rovnaký ako tool call z Ollamy.
     *
     * @param  array<string, mixed>  $message
     */
    public static function normalise(array $message, int $durationMs = 0): LlmResponse
    {
        $text = '';
        $toolCalls = [];

        $content = is_array($message['content'] ?? null) ? $message['content'] : [];

        foreach ($content as $block) {
            $block = self::wireShape($block);
            $type = (string) ($block['type'] ?? '');

            if ($type === 'text') {
                $text .= (string) ($block['text'] ?? '');

                continue;
            }

            if ($type === 'tool_use') {
                $toolCalls[] = new LlmToolCall(
                    id: (string) ($block['id'] ?? ''),
                    name: (string) ($block['name'] ?? ''),
                    arguments: LlmToolCall::decodeArguments($block['input'] ?? []),
                );
            }

            // `thinking` a serverové tool bloky sa do textu NEpripočítavajú:
            // konzola zobrazuje odpoveď, nie uvažovanie.
        }

        $usage = self::wireShape($message['usage'] ?? []);

        return new LlmResponse(
            text: $text,
            toolCalls: $toolCalls,
            stopReason: self::stopReason($message, $toolCalls !== []),
            tokensIn: (int) ($usage['input_tokens'] ?? 0),
            tokensOut: (int) ($usage['output_tokens'] ?? 0),
            durationMs: $durationMs,
            model: (string) ($message['model'] ?? ''),
            // Anthropic čas generovania nemeria, takže tokeny/s vychádzajú z
            // celého ťahu. Cez sieť je to rovnako pravdivé číslo — tam nie je
            // nahrávanie modelu, ktoré by ho skreslilo.
            evalDurationMs: null,
        );
    }

    /**
     * Kanonické správy → `messages` pre SDK.
     *
     * Dva preklady, ktoré Ollama nepotrebuje:
     *  1. volania toolov idú ako `tool_use` bloky v obsahu asistenta,
     *  2. výsledky toolov idú ako `tool_result` bloky v správe s rolou `user`.
     *
     * Pasca: Anthropic vyžaduje VŠETKY `tool_result` k jednému ťahu asistenta v
     * JEDNEJ user správe. Dva tooly za sebou preto nesmú vzniknúť ako dve
     * správy — spájajú sa, kým beží súvislý rad rolí `tool`.
     *
     * Kľúče sú camelCase (`toolUseID`, `inputSchema`) — tak ich prijímajú polia
     * v tomto SDK a serializér ich sám preklopí na `tool_use_id` a
     * `input_schema`. Overené proti `Conversion::dump(MessageCreateParams…)`.
     *
     * @param  list<array<string, mixed>>  $messages
     * @return list<array<string, mixed>>
     */
    protected function encodeMessages(array $messages): array
    {
        $encoded = [];
        /** @var list<array<string, mixed>> $pendingResults */
        $pendingResults = [];

        $flush = function () use (&$encoded, &$pendingResults) {
            if ($pendingResults !== []) {
                $encoded[] = ['role' => 'user', 'content' => $pendingResults];
                $pendingResults = [];
            }
        };

        foreach ($messages as $message) {
            $role = (string) ($message['role'] ?? 'user');
            $content = (string) ($message['content'] ?? '');

            if ($role === 'tool') {
                $pendingResults[] = array_filter([
                    'type' => 'tool_result',
                    'toolUseID' => (string) ($message['tool_call_id'] ?? ''),
                    'content' => $content === '' ? null : $content,
                ], fn ($value) => $value !== null);

                continue;
            }

            $flush();

            $blocks = [];

            if ($content !== '') {
                $blocks[] = ['type' => 'text', 'text' => $content];
            }

            $calls = is_array($message['tool_calls'] ?? null) ? $message['tool_calls'] : [];

            foreach ($calls as $call) {
                $block = $this->encodeToolCall($call);

                if ($block !== null) {
                    $blocks[] = $block;
                }
            }

            if ($blocks === []) {
                continue;
            }

            // Jediný textový blok sa posiela ako string — presne tak, ako to
            // dnes robí ChatController, aby sa história vlákna nezmenila len
            // preto, že prešla touto vrstvou.
            $encoded[] = [
                'role' => $role,
                'content' => count($blocks) === 1 && $blocks[0]['type'] === 'text'
                    ? $blocks[0]['text']
                    : $blocks,
            ];
        }

        $flush();

        return $encoded;
    }

    /**
     * @return array<string, mixed>|null
     */
    protected function encodeToolCall(mixed $call): ?array
    {
        if ($call instanceof LlmToolCall) {
            $id = $call->id;
            $name = $call->name;
            $arguments = $call->arguments;
        } elseif (is_array($call)) {
            $id = (string) ($call['id'] ?? '');
            $name = (string) ($call['name'] ?? '');
            $arguments = LlmToolCall::decodeArguments($call['arguments'] ?? []);
        } else {
            return null;
        }

        if ($id === '' || $name === '') {
            return null;
        }

        return ['type' => 'tool_use', 'id' => $id, 'name' => $name, 'input' => $arguments];
    }

    /**
     * Kanonické definície toolov → `tools` pre SDK. `parameters` sa berie ako
     * synonym `input_schema`, nech volajúci nemusí vedieť, komu hovorí.
     *
     * @param  iterable<mixed>  $tools
     * @return list<array<string, mixed>>
     */
    protected function encodeTools(iterable $tools): array
    {
        $encoded = [];

        foreach ($tools as $tool) {
            if (! is_array($tool)) {
                continue;
            }

            // Tool zabalený pre Ollamu (`function`) sa rozbalí, aby jedna sada
            // definícií obslúžila oboch poskytovateľov.
            if (isset($tool['function']) && is_array($tool['function'])) {
                $tool = $tool['function'];
            }

            $name = (string) ($tool['name'] ?? '');

            if ($name === '') {
                continue;
            }

            $schema = $tool['input_schema'] ?? $tool['parameters'] ?? ['type' => 'object'];

            $encoded[] = array_filter([
                'name' => $name,
                'description' => $tool['description'] ?? null,
                'inputSchema' => is_array($schema) ? $schema : ['type' => 'object'],
            ], fn ($value) => $value !== null);
        }

        return $encoded;
    }

    /**
     * Pojmenované argumenty pre `create()` aj `createStream()` — obe majú tú
     * istú signatúru, takže sa skladajú raz.
     *
     * @param  list<array<string, mixed>>  $messages
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    protected function arguments(array $messages, array $options): array
    {
        $arguments = [
            'maxTokens' => (int) ($options['max_tokens'] ?? self::MAX_TOKENS),
            'messages' => $this->encodeMessages($messages),
            'model' => (string) ($options['model'] ?? config('hades.chat_model')),
        ];

        if (is_string($options['system'] ?? null) && trim($options['system']) !== '') {
            $arguments['system'] = $options['system'];
        }

        $tools = $this->encodeTools($options['tools'] ?? []);

        if ($tools !== []) {
            $arguments['tools'] = $tools;
        }

        if (isset($options['temperature'])) {
            $arguments['temperature'] = (float) $options['temperature'];
        }

        return $arguments;
    }

    /**
     * @throws ProviderUnavailableException keď kľúč nie je vyplnený
     */
    protected function client(): Client
    {
        $key = $this->apiKey();

        if ($key === '') {
            throw new ProviderUnavailableException(
                self::NAME,
                'ANTHROPIC_API_KEY je prázdny — doplň ho do .env a spusti docker compose restart.',
            );
        }

        return new Client(apiKey: $key);
    }

    protected function apiKey(): string
    {
        return trim((string) config('hades.anthropic_api_key', ''));
    }

    protected function elapsedMs(int $startedAt): int
    {
        return intdiv(hrtime(true) - $startedAt, 1_000_000);
    }

    /**
     * `text_delta` z jednej udalosti streamu; prázdny string pre všetko ostatné.
     *
     * `thinking_delta` a `input_json_delta` sa zámerne preskakujú — do `$onDelta`
     * ide len to, čo je odpoveď. Argumenty toolu by sa v UI vykreslili ako
     * rozsypaný JSON.
     *
     * @param  array<string, mixed>  $event
     */
    protected static function textDelta(array $event): string
    {
        if (($event['type'] ?? '') !== 'content_block_delta') {
            return '';
        }

        $delta = self::wireShape($event['delta'] ?? []);

        if (($delta['type'] ?? '') !== 'text_delta') {
            return '';
        }

        return (string) ($delta['text'] ?? '');
    }

    /**
     * @param  array<string, mixed>  $message
     */
    protected static function stopReason(array $message, bool $hasToolCalls): string
    {
        $reason = $message['stop_reason'] ?? null;

        if (is_string($reason) && $reason !== '') {
            return $reason;
        }

        // Snapshot z akumulátora nemusí mať `stop_reason` (napr. keď stream skončí
        // pred `message_delta`), ale tool bloky v ňom už sú — a smyčka sa
        // rozhoduje práve podľa toho.
        return $hasToolCalls ? LlmResponse::STOP_TOOL_USE : LlmResponse::STOP_END_TURN;
    }

    /**
     * Modely SDK na drôtový tvar (`snake_case` polia). Rovnaký prevod používa
     * `MessageAccumulator` v SDK; vďaka nemu je celé mapovanie čistá funkcia nad
     * poliami a testuje sa bez siete.
     *
     * @return array<string, mixed>
     */
    protected static function wireShape(mixed $value): array
    {
        if ($value instanceof JsonSerializable) {
            $value = $value->jsonSerialize();
        }

        if (is_object($value)) {
            $value = get_object_vars($value);
        }

        return is_array($value) ? $value : [];
    }
}
