<?php

namespace Tests\Feature;

use App\Llm\ChatProvider;
use App\Models\Area;
use App\Models\Message;
use App\Models\Node;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\Support\FakeProvider;
use Tests\Support\LoadsChatRoutes;
use Tests\TestCase;

/**
 * `POST /api/chat/stream` — SSE, ZAMKNUTÉ ROZHRANIE #17 (server P5, klient P6).
 *
 * Test overuje presne tie udalosti, na ktoré sa drôtuje klient: `token`, `meta`,
 * `citations`, `done`, `error`. Streamovanie musí fungovať AJ s vypnutou Ollamou —
 * šablónová odpoveď sa streamuje po slovách.
 */
class ChatStreamTest extends TestCase
{
    use LoadsChatRoutes;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config(['cache.default' => 'array', 'llm.enabled' => false]);

        $this->loadChatRoutes();

        Area::create(['name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 342]);
    }

    public function test_stream_posle_meta_tokeny_a_done_aj_bez_ollamy(): void
    {
        Node::create([
            'type' => 'skill', 'source' => 'test', 'area_id' => Area::first()->id,
            'label' => 'Docker kontejnery', 'description' => 'Compose a healthchecky.',
            'strength' => 5, 'last_activated_at' => now(),
        ]);

        $response = $this->postJson('/api/chat/stream', ['message' => 'Čo viem o Dockeri?']);

        $response->assertOk();
        $this->assertStringContainsString('text/event-stream', (string) $response->headers->get('Content-Type'));

        $body = $this->drain($response);

        $this->assertStringContainsString('event: meta', $body);
        $this->assertStringContainsString('event: token', $body);
        $this->assertStringContainsString('event: citations', $body);
        $this->assertStringContainsString('event: done', $body);
        $this->assertStringNotContainsString('event: error', $body);

        // Tokeny musia dať dohromady tú istú odpoveď, aká sa uložila do DB.
        $streamed = $this->tokensFrom($body);
        $stored = Message::where('role', 'assistant')->latest('id')->first();

        $this->assertNotNull($stored);
        $this->assertSame($stored->content, $streamed);
        $this->assertGreaterThan(1, substr_count($body, 'event: token'), 'odpoveď sa musí streamovať po častiach');
    }

    public function test_done_nesie_id_vlakna_spravy_a_meta(): void
    {
        $response = $this->postJson('/api/chat/stream', ['message' => 'Koľko uzlov mám v pamäti?']);
        $body = $this->drain($response);

        $done = $this->eventData($body, 'done');

        $this->assertIsArray($done);
        $this->assertGreaterThan(0, $done['conversation_id']);
        $this->assertGreaterThan(0, $done['message_id']);
        $this->assertSame('memory.stats', $done['meta']['intent']);
        $this->assertTrue($done['meta']['degraded'], 'bez Ollamy musí byť stav viditeľný');
    }

    public function test_stream_pokracuje_v_existujucom_vlakne(): void
    {
        $first = $this->drain($this->postJson('/api/chat/stream', ['message' => 'prvá otázka']));
        $conversationId = (int) $this->eventData($first, 'done')['conversation_id'];

        $second = $this->drain($this->postJson('/api/chat/stream', [
            'message' => 'druhá otázka',
            'conversation_id' => $conversationId,
        ]));

        $this->assertSame($conversationId, (int) $this->eventData($second, 'done')['conversation_id']);
        $this->assertSame(4, Message::where('conversation_id', $conversationId)->count());
    }

    public function test_modelova_vetva_streamuje_rozbaleny_text_z_json_obalu(): void
    {
        // FakeProvider streamuje po slovách; obal `{"text":"…"}` musí rozbaliť
        // JsonTextStream, klient nikdy nesmie vidieť JSON.
        $this->app->instance(ChatProvider::class, (new FakeProvider)->reply('{"text":"Toto je voľná odpoveď modelu."}'));

        $body = $this->drain($this->postJson('/api/chat/stream', ['message' => 'Ahoj']));

        $streamed = $this->tokensFrom($body);

        $this->assertSame('Toto je voľná odpoveď modelu.', $streamed);
        $this->assertStringNotContainsString('{"text"', $streamed, 'klient nikdy nesmie vidiet JSON obal');
        $this->assertSame('model', $this->eventData($body, 'done')['meta']['answer_source']);
    }

    public function test_model_nesmie_vlozit_vymyslene_cislo_do_streamu(): void
    {
        // Podklad neobsahuje 99999 → guard číslo zachytí a nikdy ho neodošle.
        $this->app->instance(ChatProvider::class, (new FakeProvider)->reply('{"text":"Objednávok bolo 99999 presne."}'));

        $body = $this->drain($this->postJson('/api/chat/stream', ['message' => 'Ahoj']));

        $this->assertStringNotContainsString('99999', $this->tokensFrom($body));
        $this->assertSame('model_numbers_dropped', $this->eventData($body, 'done')['meta']['reason']);
    }

    public function test_pokazeny_provider_dostreamuje_sablonu(): void
    {
        $this->app->instance(ChatProvider::class, (new FakeProvider)->broken());

        $body = $this->drain($this->postJson('/api/chat/stream', ['message' => 'Koľko uzlov mám v pamäti?']));

        $this->assertStringContainsString('event: done', $body);
        $this->assertStringNotContainsString('event: error', $body);
        $this->assertNotSame('', $this->tokensFrom($body));
    }

    public function test_obsadeny_slot_streamu_nevrati_chybu_ale_okamzitu_odpoved(): void
    {
        // Simulácia „iný stream práve beží": obsadíme jediný slot dopredu.
        config(['llm.max_concurrent_streams' => 1, 'llm.stream_queue_wait' => 300]);
        $lock = cache()->lock('llm.stream.slot.0', 60);
        $this->assertTrue($lock->get());

        try {
            $body = $this->drain($this->postJson('/api/chat/stream', ['message' => 'Koľko uzlov mám v pamäti?']));
        } finally {
            $lock->release();
        }

        $meta = $this->eventData($body, 'meta');
        $this->assertTrue($meta['queued'], 'druhá požiadavka dostane stav „v poradí", nie chybu');
        $this->assertStringContainsString('event: done', $body);
        $this->assertStringNotContainsString('event: error', $body);
        $this->assertTrue($this->eventData($body, 'done')['meta']['stream_queued']);
    }

    public function test_prazdna_sprava_je_422(): void
    {
        $this->postJson('/api/chat/stream', ['message' => ''])->assertStatus(422);
    }

    private function drain(TestResponse $response): string
    {
        return $response->streamedContent();
    }

    /** Spojí všetky `token` udalosti do jedného textu — presne ako klient. */
    private function tokensFrom(string $body): string
    {
        $text = '';

        foreach ($this->events($body) as [$event, $data]) {
            if ($event === 'token') {
                $text .= (string) ($data['text'] ?? '');
            }
        }

        return $text;
    }

    /** @return array<string, mixed>|null */
    private function eventData(string $body, string $wanted): ?array
    {
        foreach ($this->events($body) as [$event, $data]) {
            if ($event === $wanted) {
                return $data;
            }
        }

        return null;
    }

    /** @return list<array{0: string, 1: array<string, mixed>}> */
    private function events(string $body): array
    {
        $out = [];

        foreach (preg_split("/\n\n/", trim($body)) ?: [] as $block) {
            if (! preg_match('/^event: (\S+)\ndata: (.*)$/s', trim($block), $m)) {
                continue;
            }
            $decoded = json_decode($m[2], true);
            $out[] = [$m[1], is_array($decoded) ? $decoded : []];
        }

        return $out;
    }
}
