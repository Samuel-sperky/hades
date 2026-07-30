<?php

namespace Tests\Feature;

use App\Llm\ChatProvider;
use App\Models\Area;
use App\Models\Conversation;
use App\Models\Decision;
use App\Models\Message;
use App\Models\Node;
use App\Services\Chat\ChatAnswer;
use App\Services\Chat\DomainAnswerer;
use App\Services\Chat\Intent;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\FakeProvider;
use Tests\Support\LoadsChatRoutes;
use Tests\TestCase;

/**
 * `POST /api/chat` — trojvrstvová architektúra ako celok.
 *
 * KĽÚČOVÉ AKCEPTAČNÉ KRITÉRIUM (#23): pri nedostupnom modeli musí chat odpovedať
 * zmysluplne z grafu, HTTP 200 a `meta.degraded = true`. Žiadna 500, žiadny
 * prázdny stav. Väčšina testov preto beží s NullProviderom, teda presne v stave
 * „Ollama vôbec nebeží".
 */
class ChatTest extends TestCase
{
    use LoadsChatRoutes;
    use RefreshDatabase;

    private int $areaId;

    protected function setUp(): void
    {
        parent::setUp();

        config(['cache.default' => 'array', 'llm.enabled' => false]);

        $this->loadChatRoutes();

        $this->areaId = Area::create([
            'name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 342,
        ])->id;
    }

    private function node(string $label, string $type = 'skill', string $description = ''): Node
    {
        return Node::create([
            'type' => $type,
            'source' => 'test',
            'area_id' => $this->areaId,
            'label' => $label,
            'description' => $description !== '' ? $description : $label.' — popis',
            'strength' => 5,
            'last_activated_at' => now(),
        ]);
    }

    public function test_chat_odpovie_zo_sablony_aj_s_null_providerom(): void
    {
        $this->node('Docker kontejnery', 'skill', 'Compose, healthchecky a volumes v Dockeri.');

        $response = $this->postJson('/api/chat', ['message' => 'Čo viem o Dockeri?']);

        $response->assertOk();
        $this->assertNotSame('', $response->json('reply'));
        $this->assertStringContainsString('Docker', (string) $response->json('reply'));
        $this->assertSame('memory.about', $response->json('meta.intent'));
        $this->assertSame('deterministic', $response->json('meta.intent_source'));
        $this->assertSame('template', $response->json('meta.answer_source'));
    }

    public function test_pri_vypnutej_ollame_je_odpoved_200_a_degradovana(): void
    {
        $response = $this->postJson('/api/chat', ['message' => 'Koľko uzlov mám v pamäti?']);

        $response->assertOk();
        $this->assertTrue($response->json('meta.degraded'), 'stav modelu musí byť viditeľný v meta');
        $this->assertNotNull($response->json('meta.reason'));
        $this->assertNotSame('', $response->json('reply'));
    }

    public function test_statistiky_su_realne_cisla_z_databazy(): void
    {
        $this->node('A');
        $this->node('B', 'project');
        $this->node('C', 'memory');

        $reply = (string) $this->postJson('/api/chat', ['message' => 'Koľko uzlov mám v pamäti?'])->json('reply');

        $this->assertStringContainsString('3 uzl', $reply, 'počet uzlov musí prísť z DB, nie z modelu');
        $this->assertSame('memory.stats', $this->postJson('/api/chat', ['message' => 'štatistiky siete'])->json('meta.intent'));
    }

    public function test_rozhodnutia_sa_skladaju_z_realnych_zaznamov(): void
    {
        $node = $this->node('Rozhodnutie', 'memory');
        Decision::create([
            'node_id' => $node->id,
            'area_id' => $this->areaId,
            'decided_on' => now()->toDateString(),
            'text' => 'Streamovanie ide cez SSE, nie cez WebSocket.',
            'reason' => 'Kanál pulzov je public.',
            'origin' => 'test',
        ]);

        $response = $this->postJson('/api/chat', ['message' => 'Aké rozhodnutia som urobil?']);

        $response->assertOk();
        $this->assertSame('memory.decisions', $response->json('meta.intent'));
        $this->assertStringContainsString('SSE', (string) $response->json('reply'));
        $this->assertContains($node->id, $response->json('cited_node_ids'));
    }

    public function test_citacie_nesu_label_uzla(): void
    {
        $node = $this->node('Reverb WebSocket', 'skill', 'Pulzy grafu bežia cez Reverb.');

        $response = $this->postJson('/api/chat', ['message' => 'Čo viem o Reverbe?']);

        $response->assertOk();
        $citations = $response->json('citations');
        $this->assertNotEmpty($citations, '„Vychádzal som z:" potrebuje uzly s labelom');
        $this->assertSame($node->id, $citations[0]['id']);
        $this->assertSame('Reverb WebSocket', $citations[0]['label']);
    }

    public function test_zamer_zapamatania_vrati_navrh_a_uzol_nevytvori(): void
    {
        $before = Node::count();

        $response = $this->postJson('/api/chat', [
            'message' => 'Zapamätaj si, že SSE stream drží workera na celý čas generovania.',
        ]);

        $response->assertOk();
        $this->assertSame('memory', $response->json('suggested_node.type'));
        $this->assertStringContainsString('SSE', (string) $response->json('suggested_node.description'));
        $this->assertSame($before, Node::count(), 'uzol vytvára až potvrdenie z frontendu');
    }

    public function test_historia_sa_persistuje_a_prezije_reload(): void
    {
        $first = $this->postJson('/api/chat', ['message' => 'Koľko uzlov mám v pamäti?']);
        $conversationId = (int) $first->json('conversation_id');

        $this->assertGreaterThan(0, $conversationId);

        $this->postJson('/api/chat', [
            'message' => 'A koľko hrán?',
            'conversation_id' => $conversationId,
        ])->assertOk();

        $this->assertSame(1, Conversation::count(), 'druhá správa nesmie vytvoriť nové vlákno');
        $this->assertSame(4, Message::where('conversation_id', $conversationId)->count());

        // „Reload prehliadača" = nové GET na obsah vlákna.
        $reload = $this->getJson('/api/chat/conversations/'.$conversationId);
        $reload->assertOk();
        $this->assertCount(4, $reload->json('messages'));
        $this->assertSame('user', $reload->json('messages.0.role'));
        $this->assertSame('assistant', $reload->json('messages.1.role'));
    }

    public function test_vlakno_dostane_auto_nazov_z_prvej_spravy(): void
    {
        $response = $this->postJson('/api/chat', ['message' => 'Ako nastavím dopravu pre šperky?']);

        $response->assertOk();
        $title = (string) $response->json('conversation_title');

        $this->assertNotSame('', $title);
        $this->assertNotSame('Nové vlákno', $title);
        $this->assertLessThanOrEqual(60, mb_strlen($title));
    }

    public function test_kontextove_cipy_uzlov_sa_prilozia_a_neznamy_uzol_nezhodi_chat(): void
    {
        $node = $this->node('Pripnutý uzol', 'skill', 'Toto je prioritný podklad.');

        $response = $this->postJson('/api/chat', [
            'message' => 'Ahoj',
            'context_node_ids' => [$node->id, 999_999],
        ]);

        $response->assertOk();
        $this->assertNotSame('', $response->json('reply'));
    }

    public function test_zoznam_vlakien_a_export_do_markdownu(): void
    {
        $id = (int) $this->postJson('/api/chat', ['message' => 'Koľko uzlov mám?'])->json('conversation_id');

        $index = $this->getJson('/api/chat/conversations');
        $index->assertOk();
        $this->assertSame($id, $index->json('conversations.0.id'));
        $this->assertSame(2, $index->json('conversations.0.message_count'));

        $export = $this->getJson('/api/chat/conversations/'.$id.'/export');
        $export->assertOk();
        $this->assertStringContainsString('## Ja', (string) $export->json('markdown'));
        $this->assertStringContainsString('## AuraAI', (string) $export->json('markdown'));
        $this->assertStringEndsWith('.md', (string) $export->json('filename'));
    }

    public function test_premenovanie_vlakna(): void
    {
        $id = (int) $this->postJson('/api/chat', ['message' => 'test'])->json('conversation_id');

        $this->putJson('/api/chat/conversations/'.$id, ['title' => 'Streamovanie chatu'])
            ->assertOk()
            ->assertJsonPath('conversation.title', 'Streamovanie chatu');
    }

    public function test_shop_zamer_bez_napojeneho_zdroja_nevymysla_cisla(): void
    {
        $response = $this->postJson('/api/chat', ['message' => 'Koľko objednávok prišlo včera?']);

        $response->assertOk();
        $this->assertSame('shop.orders_count', $response->json('meta.intent'));
        $reply = (string) $response->json('reply');
        $this->assertSame([], $this->numbersIn($reply), 'nenapojený e-shop nesmie vrátiť žiadne číslo');
        $this->assertTrue($response->json('meta.degraded'));
    }

    public function test_shop_zamer_pouzije_domain_answerer_ked_je_naviazany(): void
    {
        // Presne takto sa P11 pripojí bez toho, aby otvorila jediný súbor chatu.
        $this->app->instance(DomainAnswerer::class, new class implements DomainAnswerer
        {
            public function handles(Intent $intent): bool
            {
                return $intent->name === 'shop.orders_count';
            }

            public function answer(Intent $intent, string $message): ?ChatAnswer
            {
                return new ChatAnswer(text: 'Včera prišlo 12 objednávok.', intent: $intent);
            }
        });

        $response = $this->postJson('/api/chat', ['message' => 'Koľko objednávok prišlo včera?']);

        $response->assertOk();
        $this->assertStringContainsString('12 objednávok', (string) $response->json('reply'));
    }

    public function test_model_router_sa_zapoji_len_ked_deterministicky_nenajde_zhodu(): void
    {
        $provider = (new FakeProvider)->reply('{"intent":"memory.stats"}');
        $this->app->instance(ChatProvider::class, $provider);

        // „Ahoj" nezhodí ani jeden deterministický vzor → vrstva 2 dostane slovo.
        $this->postJson('/api/chat', ['message' => 'Ahoj'])->assertOk();
        $this->assertGreaterThanOrEqual(1, $provider->chatCalls);

        $callsAfterUnclassified = $provider->chatCalls;

        // „Koľko uzlov mám?" trafí vrstvu 1 → router modelu sa NESMIE volať.
        $response = $this->postJson('/api/chat', ['message' => 'Koľko uzlov mám v pamäti?']);
        $response->assertOk();
        $this->assertSame('deterministic', $response->json('meta.intent_source'));
        $this->assertSame(
            $callsAfterUnclassified + 1,
            $provider->chatCalls,
            'pri zhode vo vrstve 1 smie ísť k modelu už len auto-názov vlákna, nič viac',
        );
    }

    public function test_nevalidny_zamer_z_modelu_sa_zahodi(): void
    {
        // Reálne zlyhanie qwen3:0.6b — echo slova z promptu namiesto triedy.
        $this->app->instance(ChatProvider::class, (new FakeProvider)->reply('{"intent":"Kolko objednavok"}'));

        $response = $this->postJson('/api/chat', ['message' => 'Ahoj']);

        $response->assertOk();
        $this->assertSame('none', $response->json('meta.intent'));
    }

    public function test_pokazeny_provider_nezhodi_chat(): void
    {
        $this->app->instance(ChatProvider::class, (new FakeProvider)->broken());

        $response = $this->postJson('/api/chat', ['message' => 'Čo viem o Dockeri?']);

        $response->assertOk();
        $this->assertTrue($response->json('meta.degraded'));
        $this->assertNotSame('', $response->json('reply'));
    }

    public function test_health_endpoint_hlasi_stav_bez_chyby(): void
    {
        $response = $this->getJson('/api/chat/health');

        $response->assertOk();
        $this->assertFalse($response->json('chat'));
        $this->assertTrue($response->json('degraded'));
        $this->assertSame('null', $response->json('provider'));
        $this->assertNotSame('', $response->json('degraded_notice'));
        $this->assertSame('qwen3:4b', $response->json('defaults.router'));
        $this->assertSame('bge-m3', $response->json('defaults.embed'));
    }

    public function test_prazdna_sprava_je_422_a_nie_500(): void
    {
        $this->postJson('/api/chat', ['message' => ''])->assertStatus(422);
    }

    /** @return list<string> */
    private function numbersIn(string $text): array
    {
        preg_match_all('/\d+/u', $text, $matches);

        return array_values($matches[0]);
    }
}
