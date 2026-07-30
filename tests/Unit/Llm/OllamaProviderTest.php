<?php

namespace Tests\Unit\Llm;

use App\Llm\ChatOptions;
use App\Llm\EmbedOptions;
use App\Llm\OllamaProvider;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * OllamaProvider proti falšovanému HTTP. Žiadna sieť, žiadna bežiaca Ollama.
 *
 * BRÁNA ROZHRANIA #11: ani jeden scenár nesmie vyhodiť výnimku — nedostupný
 * model je normálny stav a hlási sa návratovou hodnotou.
 */
class OllamaProviderTest extends TestCase
{
    private function provider(int $healthTtl = 0): OllamaProvider
    {
        return new OllamaProvider(
            baseUrl: 'http://ollama:11434',
            chatModel: 'qwen3:4b',
            embedModel: 'bge-m3',
            models: ['router' => 'qwen3:4b', 'escalation' => 'qwen3:4b', 'embed' => 'bge-m3'],
            tasks: [
                'router' => ['model' => 'router', 'think' => false, 'format' => 'json', 'temperature' => 0.0, 'num_predict' => 64],
            ],
            timeouts: ['connect' => 5_000, 'idle' => 30_000, 'total' => 300_000],
            keepAlive: '30m',
            healthTtl: $healthTtl,
        );
    }

    public function test_chat_vrati_text_a_metriky(): void
    {
        Http::fake([
            '*/api/chat' => Http::response([
                'model' => 'qwen3:4b',
                'message' => ['role' => 'assistant', 'content' => '{"intent":"shop.revenue"}'],
                'done' => true,
                'done_reason' => 'stop',
                'prompt_eval_count' => 35,
                'eval_count' => 18,
                'eval_duration' => 1_000_000_000,
            ]),
        ]);

        $result = $this->provider()->chat(
            [['role' => 'user', 'content' => 'Aký bol obrat?']],
            new ChatOptions(task: 'router'),
        );

        $this->assertTrue($result->ok());
        $this->assertSame('{"intent":"shop.revenue"}', $result->text);
        $this->assertSame('qwen3:4b', $result->model);
        $this->assertSame(35, $result->promptTokens);
        $this->assertSame(18, $result->completionTokens);
        $this->assertSame(18.0, $result->tokPerS);
    }

    public function test_chat_posiela_think_false_a_format_json_z_konfiguracie_ulohy(): void
    {
        Http::fake([
            '*/api/chat' => Http::response(['message' => ['content' => '{"intent":"none"}'], 'done' => true]),
        ]);

        $this->provider()->chat([['role' => 'user', 'content' => 'ahoj']], new ChatOptions(task: 'router'));

        Http::assertSent(function ($request) {
            $body = $request->data();

            // Bez `think:false` je qwen3 reasoning model a vráti prázdnu odpoveď;
            // bez `format:json` sa uvažovanie vylieva do obsahu. Oboje je povinné.
            $this->assertFalse($body['think']);
            $this->assertSame('json', $body['format']);
            $this->assertSame(0.0, $body['options']['temperature']);
            $this->assertSame('qwen3:4b', $body['model']);
            $this->assertFalse($body['stream']);

            return true;
        });
    }

    public function test_stream_rozparsuje_ndjson_a_zavola_ondelta(): void
    {
        $ndjson = implode("\n", [
            json_encode(['message' => ['content' => 'V pam'], 'done' => false]),
            json_encode(['message' => ['content' => 'äti mám'], 'done' => false]),
            json_encode(['message' => ['content' => ' 679 uzlov'], 'done' => false]),
            json_encode([
                'model' => 'qwen3:4b', 'message' => ['content' => ''], 'done' => true, 'done_reason' => 'stop',
                'prompt_eval_count' => 10, 'eval_count' => 6, 'eval_duration' => 2_000_000_000,
            ]),
        ])."\n";

        $this->fakeStream($ndjson);

        $deltas = [];
        $result = $this->provider()->stream(
            [['role' => 'user', 'content' => 'q']],
            new ChatOptions(task: 'router'),
            function (string $text) use (&$deltas): void { $deltas[] = $text; },
        );

        $this->assertSame(['V pam', 'äti mám', ' 679 uzlov'], $deltas);
        $this->assertSame('V pamäti mám 679 uzlov', $result->text);
        $this->assertTrue($result->ok());
        $this->assertSame(3.0, $result->tokPerS);
    }

    public function test_embed_vrati_vektory_v_poradi_vstupu(): void
    {
        Http::fake([
            '*/api/embed' => Http::response(['embeddings' => [[0.1, 0.2], [0.3, 0.4]]]),
        ]);

        $vectors = $this->provider()->embed(['šperky', 'jewelry'], new EmbedOptions(model: 'bge-m3', dimensions: 1024));

        $this->assertCount(2, $vectors);
        $this->assertSame([0.1, 0.2], $vectors[0]);
    }

    public function test_embed_pri_nedostupnom_modeli_vrati_prazdny_list_bez_vynimky(): void
    {
        Http::fake(['*/api/embed' => Http::response(['error' => 'model not found'], 404)]);

        $this->assertSame([], $this->provider()->embed(['x'], new EmbedOptions));
    }

    public function test_health_precita_zoznam_modelov(): void
    {
        Http::fake([
            '*/api/tags' => Http::response(['models' => [
                ['model' => 'qwen3:4b'],
                ['model' => 'bge-m3:latest'],
            ]]),
        ]);

        $health = $this->provider()->health();

        $this->assertTrue($health->ok);
        $this->assertTrue($health->chat);
        $this->assertTrue($health->embed, 'bge-m3:latest musí sedieť na config hodnotu bge-m3');
        $this->assertContains('qwen3:4b', $health->models);
        $this->assertNull($health->error);
    }

    public function test_health_hlasi_chybajuce_modely_bez_vynimky(): void
    {
        Http::fake(['*/api/tags' => Http::response(['models' => [['model' => 'llama3:8b']]])]);

        $health = $this->provider()->health();

        $this->assertFalse($health->ok);
        $this->assertFalse($health->chat);
        $this->assertNotNull($health->error);
    }

    public function test_nedostupna_ollama_nevyhodi_vynimku_v_ziadnej_metode(): void
    {
        Http::fake(fn () => throw new ConnectionException('connect refused'));

        $provider = $this->provider();

        $chat = $provider->chat([['role' => 'user', 'content' => 'q']], new ChatOptions(task: 'router'));
        $this->assertFalse($chat->ok());
        $this->assertSame('error', $chat->finishReason);
        $this->assertSame('Ollama nie je dostupná', $chat->error);

        $stream = $provider->stream([['role' => 'user', 'content' => 'q']], new ChatOptions, fn () => null);
        $this->assertFalse($stream->ok());

        $this->assertSame([], $provider->embed(['x'], new EmbedOptions));
        $this->assertFalse($provider->health()->ok);
    }

    public function test_chybajuci_model_je_404_a_nie_vynimka(): void
    {
        Http::fake(['*/api/chat' => Http::response(['error' => 'model "x" not found'], 404)]);

        $result = $this->provider()->chat([['role' => 'user', 'content' => 'q']], new ChatOptions);

        $this->assertFalse($result->ok());
        $this->assertSame('model nie je stiahnutý', $result->error);
    }

    public function test_prazdna_odpoved_modelu_je_chyba_a_nie_prazdny_text(): void
    {
        // Presne to, čo vracia qwen3 bez `think:false` — prázdny `content`.
        Http::fake(['*/api/chat' => Http::response(['message' => ['content' => ''], 'done' => true])]);

        $result = $this->provider()->chat([['role' => 'user', 'content' => 'q']], new ChatOptions);

        $this->assertFalse($result->ok());
    }

    /**
     * Streamovaná odpoveď: `Http::fake` s reťazcom vracia telo naraz, čo je pre
     * NDJSON parser postačujúce — testujeme rozklad na riadky, nie sieť.
     */
    private function fakeStream(string $ndjson): void
    {
        Http::fake(function () use ($ndjson) {
            return Http::response($ndjson, 200, ['Content-Type' => 'application/x-ndjson']);
        });
    }
}
