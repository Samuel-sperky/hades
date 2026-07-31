<?php

namespace Tests\Feature\Sperky;

use App\Services\Chat\ChatAnswer;
use App\Services\Chat\DomainAnswerer;
use App\Services\Chat\Intent;
use App\Services\Sperky\SperkyDomainAnswerer;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Napojenie chatu na SPERKY — spojka, ktorú si dva balíky navzájom prehodili
 * a nenapísal ju nikto, takže chat na každú otázku o e-shope odpovedal šablónou
 * „napojenie ešte nie je aktívne".
 *
 * Najdôležitejšie tvrdenie: **čísla skladá kód, nie model**, a **súhrnný obrat
 * naprieč menami nevznikne nikdy** (nález N1 — `total_paid` je v mene objednávky,
 * ale API menu nevracia, takže súčet by spočítal HUF s EUR).
 */
class ChatDomainAnswererTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        config(['sperky.api_key' => 'test-key-nie-je-skutocny']);
    }

    public function test_answerer_je_nabindovany_v_kontejneri(): void
    {
        // Bez tejto väzby sa `ChatPipeline::domainAnswer()` ani nespýta a chat
        // odpovie šablónou — presne to bol pôvodný stav.
        $this->assertTrue(app()->bound(DomainAnswerer::class));
        $this->assertInstanceOf(SperkyDomainAnswerer::class, app(DomainAnswerer::class));
    }

    public function test_obsluhuje_shop_zamery_a_ine_nie(): void
    {
        $a = app(DomainAnswerer::class);

        foreach (['shop.orders_count', 'shop.revenue', 'shop.order_detail', 'shop.product_lookup', 'shop.countries'] as $name) {
            $this->assertTrue($a->handles(new Intent($name)), $name.' má byť obslúžený');
        }

        foreach (['memory.about', 'none', 'memory.stats'] as $name) {
            $this->assertFalse($a->handles(new Intent($name)), $name.' NEMÁ byť obslúžený');
        }
    }

    public function test_detail_objednavky_uvadza_menu_a_priznava_odhad(): void
    {
        Http::fake([
            '*/api/order/get*' => Http::response(['result' => [
                'ok' => true, 'id' => 1763435, 'date_add' => '2026-07-28 12:29:28',
                'total_paid' => 11215.0, 'product_ids' => [30582],
                'country' => 'Maďarsko', 'country_iso' => 'HU',
            ]]),
        ]);

        $answer = app(DomainAnswerer::class)->answer(
            new Intent('shop.order_detail', ['order_id' => '1763435']),
            'detail objednávky 1763435',
        );

        $this->assertInstanceOf(ChatAnswer::class, $answer);
        $this->assertSame('template', $answer->source, 'čísla musí skladať kód, nie model');
        $this->assertStringContainsString('HUF', $answer->text, 'suma bez meny je nezmysel (N1)');
        $this->assertStringContainsString('odhadnutá', $answer->text, 'mena je odhad z krajiny, musí to byť priznané');
        $this->assertStringContainsString('11 215', $answer->text);
    }

    public function test_obrat_nikdy_nevrati_jedno_suhrnne_cislo(): void
    {
        // Dve objednávky v rôznych menách: 100 EUR (SK) + 11 215 HUF (HU).
        // Súčet 11 315 je presne to číslo, ktoré nesmie nikde vzniknúť.
        Http::fake([
            '*/api/order?*' => Http::response(['result' => [
                'data' => [
                    ['id' => 2, 'date_add' => now()->format('Y-m-d H:i:s'), 'total_paid' => 100.0],
                    ['id' => 1, 'date_add' => now()->format('Y-m-d H:i:s'), 'total_paid' => 11215.0],
                ],
                'page' => 1, 'per_page' => 100, 'total' => 1763918,
            ]]),
            '*/api/order/get*' => Http::response(['result' => ['ok' => false, 'error' => 'not found']]),
        ]);

        $answer = app(DomainAnswerer::class)->answer(new Intent('shop.revenue'), 'aký bol obrat');

        $this->assertInstanceOf(ChatAnswer::class, $answer);
        $this->assertStringNotContainsString('11 315', $answer->text, 'súčet naprieč menami nesmie vzniknúť');
        $this->assertStringNotContainsString('11315', $answer->text);
        // Namiesto obratu musí vysvetliť, prečo ho nedá.
        $this->assertStringContainsString('menu neuvádza', $answer->text);
        $this->assertStringContainsString('1 763 918', $answer->text, 'počet objednávok povedať má');
    }

    public function test_produkt_nezobrazuje_varianty(): void
    {
        // API `attributes` nevracia (nález N2) — odpoveď o nich nesmie hovoriť.
        Http::fake([
            '*/api/products/get*' => Http::response(['result' => [
                'ok' => true, 'id' => 49, 'name' => 'Náramok z chirurgickej ocele',
                'price' => 12.3, 'description_short' => 'Krátky popis.',
            ]]),
        ]);

        $answer = app(DomainAnswerer::class)->answer(
            new Intent('shop.product_lookup', ['product_id' => '49']),
            'produkt 49',
        );

        $this->assertInstanceOf(ChatAnswer::class, $answer);
        $this->assertStringContainsString('Náramok', $answer->text);
        $this->assertStringNotContainsString('variant', mb_strtolower($answer->text));
    }

    public function test_neexistujuca_objednavka_nie_je_chyba_ale_odpoved(): void
    {
        Http::fake(['*/api/order/get*' => Http::response(['result' => ['ok' => false, 'error' => 'not found']])]);

        $answer = app(DomainAnswerer::class)->answer(
            new Intent('shop.order_detail', ['order_id' => '999999999']),
            'objednávka 999999999',
        );

        $this->assertInstanceOf(ChatAnswer::class, $answer);
        $this->assertStringContainsString('nenašiel', $answer->text);
    }

    public function test_nedostupne_api_vrati_null_a_nevyhodi_vynimku(): void
    {
        // `null` znamená „nedokázal som odpovedať" → chat použije šablónu.
        // Výnimka by prebublala do chatovej cesty a zhodila odpoveď.
        Http::fake(['*' => Http::response(['error' => 'forbidden'], 200)]);

        $answer = app(DomainAnswerer::class)->answer(new Intent('shop.orders_count'), 'koľko objednávok');

        $this->assertNull($answer);
    }

    public function test_detail_bez_id_nevymysla_si(): void
    {
        Http::fake(['*' => Http::response(['result' => ['ok' => false, 'error' => 'no id']])]);

        $this->assertNull(app(DomainAnswerer::class)->answer(new Intent('shop.order_detail'), 'detail objednávky'));
    }
}
