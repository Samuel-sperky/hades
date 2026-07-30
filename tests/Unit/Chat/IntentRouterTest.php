<?php

namespace Tests\Unit\Chat;

use App\Services\Chat\IntentRouter;
use App\Services\Chat\TextNormalizer;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * VRSTVA 1 — deterministický router. Toto je brána celej chatovej architektúry:
 * keď padne tento test, chat prestane rozumieť dopytom aj s bežiacim modelom,
 * lebo model je len doplnok (docs/BENCHMARK-LLM.md §2).
 *
 * Tabuľka pokrýva SK s diakritikou aj bez nej — používateľ píše oboje.
 */
class IntentRouterTest extends TestCase
{
    private IntentRouter $router;

    protected function setUp(): void
    {
        parent::setUp();
        $this->router = new IntentRouter(new TextNormalizer);
    }

    /** @return list<array{0: string, 1: string}> */
    public static function queries(): array
    {
        return [
            // --- shop: číslo v dopyte ---------------------------------------
            ['Ukáž detail objednávky 12345', 'shop.order_detail'],
            ['ukaz detail objednavky 12345', 'shop.order_detail'],
            ['Aký je stav objednávky č. 981?', 'shop.order_detail'],
            ['objednávka 4711', 'shop.order_detail'],
            ['Čo vieš o produkte 88?', 'shop.product_lookup'],
            ['produkt 40483', 'shop.product_lookup'],

            // --- shop: kľúčové slová ---------------------------------------
            ['Koľko objednávok prišlo včera?', 'shop.orders_count'],
            ['kolko objednavok mame za 30 dni', 'shop.orders_count'],
            ['Aký bol obrat minulý mesiac?', 'shop.revenue'],
            ['aké boli tržby za júl', 'shop.revenue'],
            ['Z ktorých krajín mám najviac zákazníkov?', 'shop.countries'],
            ['Aké produkty sa najviac predávajú?', 'shop.product_lookup'],

            // --- pamäť ------------------------------------------------------
            ['Koľko uzlov mám v pamäti?', 'memory.stats'],
            ['ukáž mi štatistiky siete', 'memory.stats'],
            ['Aké rozhodnutia som urobil?', 'memory.decisions'],
            ['Na čom som robil minulý týždeň?', 'memory.recent_work'],
            ['na com pracujem teraz', 'memory.recent_work'],
            ['Aké skilly mám v marketingu?', 'memory.skills_in_area'],
            ['Ukáž mi projekt Šperky', 'memory.project'],
            ['Čo viem o Dockeri?', 'memory.about'],
            ['co vies o cenotvorbe', 'memory.about'],
            ['Povedz mi o Reverbe', 'memory.about'],

            // --- nič ---------------------------------------------------------
            ['Ahoj', 'none'],
            ['ďakujem', 'none'],
            ['', 'none'],
        ];
    }

    #[DataProvider('queries')]
    public function test_deterministicky_router_klasifikuje_sk_dopyty(string $query, string $expected): void
    {
        $intent = $this->router->route($query);

        $this->assertSame($expected, $intent->name, "dopyt [{$query}] spadol do {$intent->name}");
        $this->assertContains($intent->name, $this->router->allowedIntents(), 'router vrátil triedu mimo uzavretého enumu');
    }

    public function test_regex_vytiahne_cislo_objednavky_a_produktu(): void
    {
        $this->assertSame('12345', $this->router->route('detail objednávky 12345')->param('order_id'));
        $this->assertSame('981', $this->router->route('stav objednávky č. 981')->param('order_id'));
        $this->assertSame('88', $this->router->route('produkt 88')->param('product_id'));
    }

    public function test_router_bezi_bez_modelu_a_je_deterministicky(): void
    {
        // Ten istý dopyt musí dať ten istý výsledok pri opakovaní — router
        // nesmie závisieť od času, náhody ani od dostupnosti Ollamy.
        $first = $this->router->route('Koľko objednávok prišlo?');
        $second = $this->router->route('Koľko objednávok prišlo?');

        $this->assertSame($first->name, $second->name);
        $this->assertSame('deterministic', $first->source);
    }

    public function test_zamer_o_teme_vytiahne_subjekt(): void
    {
        $intent = $this->router->route('Čo viem o cenotvorbe šperkov?');

        $this->assertSame('memory.about', $intent->name);
        $this->assertNotNull($intent->param('subject'));
        $this->assertStringContainsString('cenotvorb', (string) $intent->param('subject'));
    }
}
