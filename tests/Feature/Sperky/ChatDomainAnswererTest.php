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
 * Napojenie chatu na SPERKY.
 *
 * Najdôležitejšie tvrdenie: **čísla skladá kód, nie model**, a **súčet naprieč
 * menami nevznikne nikdy**.
 *
 * Oproti v1 sa prepísalo tvrdenie „obrat nikdy nevráti jedno súhrnné číslo":
 * obrat chat POVIE, ale po menách (rozhodnutie 5). Staré vysvetlenie „menu API
 * neuvádza" je zmazané — už by bolo nepravdivé.
 */
class ChatDomainAnswererTest extends TestCase
{
    /** 100 EUR + 11 215 HUF = 11 315 — číslo, ktoré nesmie nikde vzniknúť. */
    private const FORBIDDEN_SUM = '11315';

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        config([
            'cache.default' => 'array',
            'sperky.api_key' => 'test-key-nie-je-skutocny',
            'sperky.attempts' => 1,
            'sperky.backoff_ms' => 0,
            'sperky.countries' => ['SK', 'HU'],
            'sperky.chat.days' => 7,
            'sperky.chat.revenue_max_requests' => 5,
        ]);
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

    public function test_detail_objednavky_uvadza_menu_z_api(): void
    {
        Http::fake([
            '*/api/order/get*' => Http::response(['result' => [
                'ok' => true, 'id' => 1763435, 'date_add' => '2026-07-28 12:29:28',
                'total_paid' => 11215.0, 'currency' => 'HUF',
                'products' => [['id' => 30582, 'qty' => 2]],
                'country' => 'Maďarsko', 'country_iso' => 'HU',
            ]]),
        ]);

        $answer = app(DomainAnswerer::class)->answer(
            new Intent('shop.order_detail', ['order_id' => '1763435']),
            'detail objednávky 1763435',
        );

        $this->assertInstanceOf(ChatAnswer::class, $answer);
        $this->assertSame('template', $answer->source, 'čísla musí skladať kód, nie model');
        $this->assertStringContainsString('HUF', $answer->text);
        $this->assertStringContainsString('11 215', $answer->text);
        // Mena je z API — o odhade sa už nehovorí (rozhodnutie 7).
        $this->assertStringNotContainsString('odhad', mb_strtolower($answer->text));
        // Množstvo na položke (`products: [{id, qty}]`)
        $this->assertStringContainsString('#30582×2', $answer->text);
    }

    public function test_obrat_vrati_riadok_pre_kazdu_menu_a_nikdy_ich_nescita(): void
    {
        // Dve objednávky v rôznych menách: 100 EUR + 11 215 HUF.
        // Súčet 11 315 je presne to číslo, ktoré nesmie nikde vzniknúť.
        Http::fake(['*/api/order?*' => Http::response(['result' => [
            'orders' => [
                ['id' => 2, 'date_add' => now()->format('Y-m-d H:i:s'), 'total_paid' => 100.0, 'currency' => 'EUR'],
                ['id' => 1, 'date_add' => now()->format('Y-m-d H:i:s'), 'total_paid' => 11215.0, 'currency' => 'HUF'],
            ],
            'page' => 1, 'per_page' => 100, 'total' => 2,
        ]])]);

        $answer = app(DomainAnswerer::class)->answer(new Intent('shop.revenue'), 'aký bol obrat');

        $this->assertInstanceOf(ChatAnswer::class, $answer);

        // Obrat sa POVIE — po menách (rozhodnutie 5).
        $this->assertStringContainsString('100,00 EUR', $answer->text);
        $this->assertStringContainsString('11 215,00 HUF', $answer->text);

        // Ale nikdy ako jedno číslo.
        $this->assertStringNotContainsString('11 315', $answer->text);
        $this->assertStringNotContainsString(self::FORBIDDEN_SUM, str_replace(' ', '', $answer->text));

        // Staré vysvetlenie „menu API neuvádza" je nepravdivé a musí byť zmazané.
        $this->assertStringNotContainsString('menu neuvádza', $answer->text);
        $this->assertStringNotContainsString('nepoviem', $answer->text);
    }

    public function test_obrat_nezaradi_objednavku_bez_meny_do_ziadnej_sumy(): void
    {
        Http::fake(['*/api/order?*' => Http::response(['result' => [
            'orders' => [
                ['id' => 2, 'date_add' => now()->format('Y-m-d H:i:s'), 'total_paid' => 100.0, 'currency' => 'EUR'],
                ['id' => 1, 'date_add' => now()->format('Y-m-d H:i:s'), 'total_paid' => 50.0],
            ],
            'page' => 1, 'per_page' => 100, 'total' => 2,
        ]])]);

        $answer = app(DomainAnswerer::class)->answer(new Intent('shop.revenue'), 'aký bol obrat');

        $this->assertInstanceOf(ChatAnswer::class, $answer);
        $this->assertStringContainsString('100,00 EUR', $answer->text);
        // 150 by znamenalo tichý fallback na nesprávnu menu.
        $this->assertStringNotContainsString('150,00', $answer->text);
        $this->assertStringContainsString('neprišlo s menou', $answer->text);
    }

    public function test_pocty_objednavok_su_presne_z_filtrovaneho_totalu(): void
    {
        Http::fake(['*/api/order?*' => function ($request) {
            parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $query);

            if (! isset($query['date_from'])) {
                return Http::response(['result' => ['orders' => [], 'total' => 1764133]]);
            }

            return Http::response(['result' => [
                'orders' => [
                    ['id' => 2, 'date_add' => now()->format('Y-m-d H:i:s'), 'total_paid' => 10, 'currency' => 'EUR'],
                ],
                'page' => 1, 'per_page' => 100, 'total' => 1,
            ]]);
        }]);

        $answer = app(DomainAnswerer::class)->answer(new Intent('shop.orders_count'), 'koľko objednávok');

        $this->assertInstanceOf(ChatAnswer::class, $answer);
        $this->assertStringContainsString('1 764 133', $answer->text);
        // Žiadna „dolná hranica" — počet je presný (rozhodnutie 2).
        $this->assertStringNotContainsString('aspoň', $answer->text);
        $this->assertStringNotContainsString('dolná hranica', $answer->text);
    }

    public function test_krajiny_su_presne_bez_vzorky(): void
    {
        Http::fake(['*/api/order?*' => function ($request) {
            parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $query);
            $totals = ['SK' => 61, 'HU' => 22];

            return Http::response(['result' => [
                'orders' => [], 'page' => 1, 'per_page' => 1,
                'total' => isset($query['country']) ? ($totals[$query['country']] ?? 0) : 100,
            ]]);
        }]);

        $answer = app(DomainAnswerer::class)->answer(new Intent('shop.countries'), 'z akých krajín');

        $this->assertInstanceOf(ChatAnswer::class, $answer);
        $this->assertStringContainsString('SK — **61**', $answer->text);
        $this->assertStringContainsString('HU — **22**', $answer->text);
        $this->assertStringContainsString('ostatné krajiny — **17**', $answer->text);
        // Rozhodnutie 3: slovo „vzorka" z odpovede zmizlo.
        $this->assertStringNotContainsString('vzorka', mb_strtolower($answer->text));
        $this->assertStringNotContainsString('odhad', mb_strtolower($answer->text));
    }

    public function test_produkt_zobrazuje_varianty_so_stavom_zasoby(): void
    {
        // Spec v2 N2 + rozhodnutie 4: varianty sa vracajú a `quantity` sa zobrazí.
        Http::fake([
            '*/api/products/get*' => Http::response(['result' => [
                'ok' => true, 'id' => 49, 'name' => 'Náramok z chirurgickej ocele',
                'price' => 12.3, 'description_short' => 'Krátky popis.',
                'has_attributes' => true,
                'attributes' => [
                    [
                        'id_product_attribute' => 501, 'reference' => 'NR-S', 'ean13' => null,
                        'price_impact' => 0, 'quantity' => 7, 'is_default' => true,
                        'values' => [['group' => 'Veľkosť', 'value' => 'S']],
                    ],
                    [
                        'id_product_attribute' => 502, 'reference' => 'NR-M', 'ean13' => null,
                        'price_impact' => 1.5, 'quantity' => 0, 'is_default' => false,
                        'values' => [['group' => 'Veľkosť', 'value' => 'M']],
                    ],
                ],
            ]]),
        ]);

        $answer = app(DomainAnswerer::class)->answer(
            new Intent('shop.product_lookup', ['product_id' => '49']),
            'produkt 49',
        );

        $this->assertInstanceOf(ChatAnswer::class, $answer);
        $this->assertStringContainsString('Náramok', $answer->text);
        $this->assertStringContainsString('Variantov: **2**', $answer->text);
        $this->assertStringContainsString('Veľkosť: S', $answer->text);
        $this->assertStringContainsString('na sklade 7 ks', $answer->text);
        $this->assertStringContainsString('na sklade 0 ks', $answer->text);
        $this->assertStringContainsString('predvolený', $answer->text);
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

        $this->assertNull(app(DomainAnswerer::class)->answer(new Intent('shop.orders_count'), 'koľko objednávok'));
        $this->assertNull(app(DomainAnswerer::class)->answer(new Intent('shop.revenue'), 'aký bol obrat'));
    }

    public function test_detail_bez_id_nevymysla_si(): void
    {
        Http::fake(['*' => Http::response(['result' => ['ok' => false, 'error' => 'no id']])]);

        $this->assertNull(app(DomainAnswerer::class)->answer(new Intent('shop.order_detail'), 'detail objednávky'));
    }
}
