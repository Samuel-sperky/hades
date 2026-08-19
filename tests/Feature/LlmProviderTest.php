<?php

namespace Tests\Feature;

use App\Services\Llm\AnthropicProvider;
use App\Services\Llm\LlmResponse;
use App\Services\Llm\LlmToolCall;
use App\Services\Llm\OllamaProvider;
use App\Services\Llm\OllamaStreamParser;
use App\Services\Llm\ProviderFactory;
use App\Services\Llm\ProviderRequestException;
use App\Services\Llm\ProviderUnavailableException;
use App\Services\Llm\UnknownProviderException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Vrstva poskytovateľov jazyka: lokálna Ollama aj Claude musia vyjsť z jedného
 * kontraktu, inak agentová smyčka konzoly vie, na akom modeli beží — a to je
 * presne to, čomu má vrstva zabrániť.
 *
 * Žiadny test nezavolá skutočný model. Ollama ide cez `Http::fake()`, Anthropic
 * cez čistú mapovaciu funkciu {@see AnthropicProvider::normalise()}. Telá
 * odpovedí v tomto súbore sú OPÍSANÉ Z ŽIVÉHO SERVERA (qwen3:1.7b, 19. 8. 2026),
 * nie vymyslené — vymyslený tvar by testoval moju predstavu, nie Ollamu.
 *
 * Pasca, ktorá určila návrh: `Http::fake()` streamovať nevie, podstrčí telo
 * naraz. Preto poradie deltov a delenie riadkov testuje priamo
 * {@see OllamaStreamParser} (čistá funkcia nad textom) a `Http::fake()` overuje
 * len to, že poskytovateľ telo správne pretlačí do parsera.
 */
class LlmProviderTest extends TestCase
{
    /** Fiktívny host, aby test nikdy netrafil skutočnú Ollamu na stroji. */
    private const HOST = 'http://ollama.test:11434';

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'hades.console.provider' => 'ollama',
            'hades.console.ollama.host' => self::HOST,
            'hades.console.ollama.model' => 'qwen3:1.7b',
            'hades.console.ollama.timeout' => 5,
        ]);
    }

    // ---- streamovanie ------------------------------------------------------

    public function test_streaming_deltas_arrive_in_order_and_concatenate(): void
    {
        $deltas = [];
        $parser = new OllamaStreamParser(function (string $delta) use (&$deltas) {
            $deltas[] = $delta;
        });

        $parser->feed($this->ndjson());
        $parser->finish();

        $this->assertSame(['A', 'ho', 'j', ',', ' jak'], $deltas);
        $this->assertSame('Ahoj, jak', implode('', $deltas));
        $this->assertSame(implode('', $deltas), $parser->text());
    }

    /**
     * Hranica HTTP chunku a hranica riadku sa nezhodujú: `read(8192)` skončí
     * uprostred JSON objektu. Keby `feed()` dekódoval aj nedokončený riadok,
     * stratil by sa práve objekt s `done` — a s ním počty tokenov.
     */
    public function test_parser_survives_a_chunk_boundary_inside_a_line(): void
    {
        $body = $this->ndjson();
        $deltas = [];
        $parser = new OllamaStreamParser(function (string $delta) use (&$deltas) {
            $deltas[] = $delta;
        });

        foreach (str_split($body, 7) as $chunk) {
            $parser->feed($chunk);
        }
        $parser->finish();

        $this->assertSame('Ahoj, jak', $parser->text());
        $this->assertSame(['A', 'ho', 'j', ',', ' jak'], $deltas);
        $this->assertTrue($parser->sawDone());
    }

    public function test_stream_returns_the_same_text_it_streamed(): void
    {
        Http::fake([self::HOST.'/api/chat' => Http::response($this->ndjson())]);

        $deltas = [];
        $response = (new OllamaProvider)->stream([
            ['role' => 'user', 'content' => 'Povedz presne: ahoj'],
        ], [], function (string $delta) use (&$deltas) {
            $deltas[] = $delta;
        });

        $this->assertSame('Ahoj, jak', $response->text);
        $this->assertSame('Ahoj, jak', implode('', $deltas));

        Http::assertSent(fn ($request) => $request['stream'] === true);
    }

    // ---- tokeny a čas ------------------------------------------------------

    public function test_token_counts_and_duration_come_from_the_done_object(): void
    {
        Http::fake([self::HOST.'/api/chat' => Http::response($this->ndjson())]);

        $response = (new OllamaProvider)->stream(
            [['role' => 'user', 'content' => 'ahoj']],
            [],
            fn () => null,
        );

        $this->assertSame(25, $response->tokensIn, 'prompt_eval_count → tokensIn');
        $this->assertSame(12, $response->tokensOut, 'eval_count → tokensOut');
        // 659 169 841 ns → 659 ms; 383 916 000 ns → 383 ms
        $this->assertSame(659, $response->durationMs);
        $this->assertSame(383, $response->evalDurationMs);
        $this->assertSame('qwen3:1.7b', $response->model);
        $this->assertSame(LlmResponse::STOP_MAX_TOKENS, $response->stopReason, 'done_reason "length"');
        $this->assertEqualsWithDelta(31.33, $response->tokensPerSecond(), 0.01);
    }

    /**
     * Tokeny/s sa počítajú z `eval_duration`, nie z celého ťahu. Po studenom
     * starte je nahranie modelu do RAM väčšina času (namerané 9,2 s z 10,8 s) a
     * z celku by rýchlosť modelu vyšla desaťkrát nižšia.
     */
    public function test_tokens_per_second_ignores_model_load_time(): void
    {
        $parser = new OllamaStreamParser;
        $parser->line(json_encode([
            'model' => 'qwen3:1.7b',
            'message' => ['role' => 'assistant', 'content' => ''],
            'done' => true,
            'done_reason' => 'stop',
            'total_duration' => 10_825_030_491,
            'load_duration' => 9_235_446_165,
            'prompt_eval_count' => 164,
            'eval_count' => 26,
            'eval_duration' => 1_192_005_000,
        ]));

        $response = $parser->response();

        $this->assertSame(10825, $response->durationMs);
        $this->assertSame(1192, $response->evalDurationMs);
        $this->assertEqualsWithDelta(21.81, $response->tokensPerSecond(), 0.01);
    }

    // ---- znormalizované volanie toolu --------------------------------------

    /**
     * Jadro celého kontraktu: ten istý tool, ten istý tvar, dva rôzne modely.
     */
    public function test_a_tool_call_normalises_identically_from_both_providers(): void
    {
        // Odpoveď opísaná z živej Ollamy — `arguments` je objekt, nie JSON string.
        $ollamaBody = json_encode([
            'model' => 'qwen3:1.7b',
            'message' => [
                'role' => 'assistant',
                'content' => '',
                'tool_calls' => [[
                    'id' => 'call_nh2jfykt',
                    'function' => [
                        'index' => 0,
                        'name' => 'mind_recall',
                        'arguments' => ['topic' => 'Košice', 'limit' => 5],
                    ],
                ]],
            ],
            'done' => true,
            'done_reason' => 'stop',
            'prompt_eval_count' => 164,
            'eval_count' => 26,
        ], JSON_UNESCAPED_UNICODE);

        Http::fake([self::HOST.'/api/chat' => Http::response($ollamaBody)]);

        $fromOllama = (new OllamaProvider)->chat([['role' => 'user', 'content' => 'čo vieš o Košiciach?']]);

        // Odpoveď v tvare Anthropicu — `input` je objekt, `id` je `toolu_…`.
        $fromAnthropic = AnthropicProvider::normalise([
            'model' => 'claude-sonnet-5',
            'stop_reason' => 'tool_use',
            'content' => [
                ['type' => 'text', 'text' => ''],
                [
                    'type' => 'tool_use',
                    'id' => 'call_nh2jfykt',
                    'name' => 'mind_recall',
                    'input' => ['topic' => 'Košice', 'limit' => 5],
                ],
            ],
            'usage' => ['input_tokens' => 164, 'output_tokens' => 26],
        ]);

        $expected = [new LlmToolCall(
            id: 'call_nh2jfykt',
            name: 'mind_recall',
            arguments: ['topic' => 'Košice', 'limit' => 5],
        )];

        $this->assertEquals($expected, $fromOllama->toolCalls);
        $this->assertEquals($expected, $fromAnthropic->toolCalls);
        $this->assertEquals($fromOllama->toolCalls, $fromAnthropic->toolCalls);

        // A rovnaký dôvod zastavenia, hoci Ollama hlási len `done_reason: stop`.
        $this->assertSame(LlmResponse::STOP_TOOL_USE, $fromOllama->stopReason);
        $this->assertSame(LlmResponse::STOP_TOOL_USE, $fromAnthropic->stopReason);
        $this->assertTrue($fromOllama->hasToolCalls());
        $this->assertTrue($fromAnthropic->hasToolCalls());

        $this->assertSame(164, $fromOllama->tokensIn);
        $this->assertSame(164, $fromAnthropic->tokensIn);
    }

    /**
     * Anthropic pri streamovaní skladá argumenty z `input_json_delta`, takže
     * niekde v ceste je JSON string. Znormalizovaný tvar je pole v oboch
     * prípadoch — smyčka o rozdiele nesmie vedieť.
     */
    public function test_tool_arguments_are_decoded_even_when_they_arrive_as_a_json_string(): void
    {
        $response = AnthropicProvider::normalise([
            'content' => [[
                'type' => 'tool_use',
                'id' => 'toolu_1',
                'name' => 'mind_read',
                'input' => '{"id":42}',
            ]],
        ]);

        $this->assertSame(['id' => 42], $response->toolCalls[0]->arguments);
        $this->assertSame([], LlmToolCall::decodeArguments('toto nie je JSON'));
        $this->assertSame([], LlmToolCall::decodeArguments(null));
    }

    // ---- factory -----------------------------------------------------------

    public function test_unknown_provider_name_throws(): void
    {
        $this->expectException(UnknownProviderException::class);
        $this->expectExceptionMessage('olama');

        (new ProviderFactory)->make('olama');
    }

    public function test_unknown_provider_in_config_throws_instead_of_defaulting(): void
    {
        config(['hades.console.provider' => 'gpt']);

        $this->expectException(UnknownProviderException::class);

        (new ProviderFactory)->make();
    }

    public function test_missing_anthropic_key_means_unavailable_and_ollama_still_resolves(): void
    {
        config(['hades.anthropic_api_key' => '']);

        $factory = new ProviderFactory;

        $anthropic = $factory->make('anthropic');
        $this->assertInstanceOf(AnthropicProvider::class, $anthropic);
        $this->assertFalse($anthropic->available());

        // Statický zoznam modelov musí fungovať aj bez kľúča — konzola ho
        // potrebuje práve na to, aby ponúkla, čo sa dá zapnúť.
        $this->assertContains('claude-sonnet-5', $anthropic->models());
        $this->assertNotContains('claude-opus-4-5@20251101', $anthropic->models(), 'Vertex id sem nepatrí');

        $ollama = $factory->make();
        $this->assertInstanceOf(OllamaProvider::class, $ollama);
        $this->assertSame('ollama', $ollama->name());
    }

    public function test_anthropic_chat_without_a_key_throws_a_domain_exception(): void
    {
        config(['hades.anthropic_api_key' => '']);

        $this->expectException(ProviderUnavailableException::class);
        $this->expectExceptionMessage('ANTHROPIC_API_KEY');

        (new AnthropicProvider)->chat([['role' => 'user', 'content' => 'ahoj']]);
    }

    public function test_factory_returns_the_same_instance_for_one_name(): void
    {
        $factory = new ProviderFactory;

        $this->assertSame($factory->make('ollama'), $factory->make('ollama'));
        $this->assertSame(['ollama', 'anthropic'], $factory->names());
    }

    // ---- dostupnosť a zoznam modelov --------------------------------------

    public function test_ollama_models_come_from_api_tags(): void
    {
        Http::fake([self::HOST.'/api/tags' => Http::response([
            'models' => [
                ['name' => 'qwen3:8b', 'model' => 'qwen3:8b'],
                ['name' => 'bge-m3:latest', 'model' => 'bge-m3:latest'],
                ['name' => 'staré-bez-model-kluca'],
            ],
        ])]);

        $provider = new OllamaProvider;

        $this->assertSame(['qwen3:8b', 'bge-m3:latest', 'staré-bez-model-kluca'], $provider->models());
        $this->assertTrue($provider->available());
    }

    public function test_unreachable_ollama_is_unavailable_without_throwing(): void
    {
        Http::fake(fn () => throw new ConnectionException('spojenie odmietnuté'));

        $provider = new OllamaProvider;

        $this->assertFalse($provider->available());
        $this->assertSame([], $provider->models());
    }

    public function test_unreachable_ollama_throws_a_domain_exception_on_chat(): void
    {
        Http::fake(fn () => throw new ConnectionException('spojenie odmietnuté'));

        $this->expectException(ProviderUnavailableException::class);

        (new OllamaProvider)->chat([['role' => 'user', 'content' => 'ahoj']]);
    }

    // ---- chyby v tele streamu ---------------------------------------------

    /** Ollama vracia chybu s HTTP 200 v tele, takže stavový kód ju nezachytí. */
    public function test_error_inside_the_stream_body_throws(): void
    {
        Http::fake([self::HOST.'/api/chat' => Http::response(
            json_encode(['error' => 'model "qwen3:70b" not found'])
        )]);

        $this->expectException(ProviderRequestException::class);

        (new OllamaProvider)->chat([['role' => 'user', 'content' => 'ahoj']]);
    }

    /** Stream bez objektu `done: true` je odseknutý ťah, nie hotová odpoveď. */
    public function test_truncated_stream_throws_instead_of_looking_finished(): void
    {
        Http::fake([self::HOST.'/api/chat' => Http::response(
            '{"model":"qwen3:1.7b","message":{"role":"assistant","content":"Aho"},"done":false}'."\n"
        )]);

        $this->expectException(ProviderRequestException::class);

        (new OllamaProvider)->stream(
            [['role' => 'user', 'content' => 'ahoj']],
            [],
            fn () => null,
        );
    }

    // ---- preklad správ a toolov -------------------------------------------

    public function test_ollama_gets_system_as_a_message_and_tool_results_as_role_tool(): void
    {
        Http::fake([self::HOST.'/api/chat' => Http::response($this->ndjson())]);

        (new OllamaProvider)->chat($this->toolConversation(), [
            'system' => 'Si Hades.',
            'tools' => [$this->toolDefinition()],
        ]);

        Http::assertSent(function ($request) {
            $body = $request->data();

            $this->assertSame(
                ['system', 'user', 'assistant', 'tool'],
                array_column($body['messages'], 'role'),
            );
            $this->assertSame('Si Hades.', $body['messages'][0]['content']);
            $this->assertSame('mind_recall', $body['messages'][3]['tool_name']);
            $this->assertSame('mind_recall', $body['messages'][2]['tool_calls'][0]['function']['name']);
            $this->assertSame(['topic' => 'Košice'], $body['messages'][2]['tool_calls'][0]['function']['arguments']);

            // `input_schema` sa u Ollamy volá `parameters`
            $this->assertSame('function', $body['tools'][0]['type']);
            $this->assertSame('mind_recall', $body['tools'][0]['function']['name']);
            $this->assertSame('object', $body['tools'][0]['function']['parameters']['type']);

            return true;
        });
    }

    /**
     * Anthropic vyžaduje všetky `tool_result` k jednému ťahu asistenta v JEDNEJ
     * user správe. Dva tooly za sebou sa preto musia spojiť — inak API request
     * odmietne a chyba sa ukáže až v cloude.
     */
    public function test_anthropic_merges_consecutive_tool_results_into_one_user_message(): void
    {
        $provider = new class extends AnthropicProvider
        {
            public function encoded(array $messages): array
            {
                return $this->encodeMessages($messages);
            }

            public function encodedTools(array $tools): array
            {
                return $this->encodeTools($tools);
            }
        };

        $conversation = $this->toolConversation();
        $conversation[] = [
            'role' => 'tool',
            'tool_call_id' => 'call_2',
            'tool_name' => 'mind_read',
            'content' => 'uzol 42',
        ];

        $encoded = $provider->encoded($conversation);

        $this->assertSame(['user', 'assistant', 'user'], array_column($encoded, 'role'));

        // asistent: text + tool_use blok
        $this->assertSame('text', $encoded[1]['content'][0]['type']);
        $this->assertSame('tool_use', $encoded[1]['content'][1]['type']);
        $this->assertSame('call_1', $encoded[1]['content'][1]['id']);
        $this->assertSame(['topic' => 'Košice'], $encoded[1]['content'][1]['input']);

        // oba výsledky v jednej user správe, s camelCase kľúčom pre SDK
        $this->assertCount(2, $encoded[2]['content']);
        $this->assertSame('tool_result', $encoded[2]['content'][0]['type']);
        $this->assertSame('call_1', $encoded[2]['content'][0]['toolUseID']);
        $this->assertSame('call_2', $encoded[2]['content'][1]['toolUseID']);

        // jediný textový blok zostáva stringom (tak to robí aj ChatController)
        $this->assertSame('čo vieš o Košiciach?', $encoded[0]['content']);

        // definícia toolu prejde na `inputSchema`, ktoré si SDK preklopí na `input_schema`
        $tools = $provider->encodedTools([$this->toolDefinition()]);
        $this->assertSame('mind_recall', $tools[0]['name']);
        $this->assertSame('object', $tools[0]['inputSchema']['type']);
    }

    /** Jedna sada definícií toolov musí prejsť oboma poskytovateľmi. */
    public function test_ollama_shaped_tool_definition_is_accepted_by_anthropic_too(): void
    {
        $provider = new class extends AnthropicProvider
        {
            public function encodedTools(array $tools): array
            {
                return $this->encodeTools($tools);
            }
        };

        $tools = $provider->encodedTools([[
            'type' => 'function',
            'function' => [
                'name' => 'mind_recall',
                'description' => 'Vyhľadá v pamäti.',
                'parameters' => ['type' => 'object', 'properties' => ['topic' => ['type' => 'string']]],
            ],
        ]]);

        $this->assertSame('mind_recall', $tools[0]['name']);
        $this->assertSame('Vyhľadá v pamäti.', $tools[0]['description']);
        $this->assertSame('object', $tools[0]['inputSchema']['type']);
    }

    // ---- podklady ----------------------------------------------------------

    /**
     * Skrátené telo streamu opísané z živého servera (`stream: true`,
     * `num_predict: 12`, done_reason `length`).
     */
    private function ndjson(): string
    {
        $lines = [
            '{"model":"qwen3:1.7b","created_at":"2026-08-19T08:39:27.283883266Z","message":{"role":"assistant","content":"A"},"done":false}',
            '{"model":"qwen3:1.7b","created_at":"2026-08-19T08:39:27.320780255Z","message":{"role":"assistant","content":"ho"},"done":false}',
            '{"model":"qwen3:1.7b","created_at":"2026-08-19T08:39:27.357740442Z","message":{"role":"assistant","content":"j"},"done":false}',
            '{"model":"qwen3:1.7b","created_at":"2026-08-19T08:39:27.392813818Z","message":{"role":"assistant","content":","},"done":false}',
            '{"model":"qwen3:1.7b","created_at":"2026-08-19T08:39:27.429579604Z","message":{"role":"assistant","content":" jak"},"done":false}',
            '{"model":"qwen3:1.7b","created_at":"2026-08-19T08:39:27.6682781Z","message":{"role":"assistant","content":""},"done":true,"done_reason":"length","total_duration":659169841,"load_duration":152124428,"prompt_eval_count":25,"prompt_eval_duration":89690000,"eval_count":12,"eval_duration":383916000}',
        ];

        return implode("\n", $lines)."\n";
    }

    /** @return list<array<string, mixed>> */
    private function toolConversation(): array
    {
        return [
            ['role' => 'user', 'content' => 'čo vieš o Košiciach?'],
            [
                'role' => 'assistant',
                'content' => 'Pozriem sa do pamäti.',
                'tool_calls' => [new LlmToolCall('call_1', 'mind_recall', ['topic' => 'Košice'])],
            ],
            [
                'role' => 'tool',
                'tool_call_id' => 'call_1',
                'tool_name' => 'mind_recall',
                'content' => 'Našiel som 3 uzly.',
            ],
        ];
    }

    /** @return array<string, mixed> */
    private function toolDefinition(): array
    {
        return [
            'name' => 'mind_recall',
            'description' => 'Vyhľadá v pamäti.',
            'input_schema' => [
                'type' => 'object',
                'properties' => ['topic' => ['type' => 'string']],
                'required' => ['topic'],
            ],
        ];
    }
}
