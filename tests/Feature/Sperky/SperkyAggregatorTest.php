<?php

namespace Tests\Feature\Sperky;

use App\Models\Area;
use App\Models\Department;
use App\Models\Node;
use App\Models\Tombstone;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Mesačný agregát: idempotencia, presné počty z filtrov, obrat PO MENÁCH a —
 * najdôležitejšie — že v uzle NIKDY nevznikne jedno číslo, ktoré by sčítalo
 * sumy v rôznych menách (rozhodnutie 1).
 *
 * Oproti v1 sa prepísalo tvrdenie „uzol neobsahuje žiadny súhrnný obrat":
 * obrat v uzle JE, len rozpadnutý po menách. Zakázaný zostáva súčet naprieč
 * menami a prepočet na jednu menu.
 *
 * Žiadne volanie na produkciu: všetko cez Http::fake(), kľúč je fiktívny.
 */
class SperkyAggregatorTest extends TestCase
{
    use RefreshDatabase;

    private const BASE = 'https://shop.test';

    /** SK 100 EUR + HU 11 215 HUF. Ich súčet (11 315) sa nesmie objaviť NIKDE. */
    private const FORBIDDEN_SUM = '11315';

    /** A ani súčet všetkých troch objednávok (100 + 20,50 + 11 215). */
    private const FORBIDDEN_SUM_ALL = '11335.5';

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'cache.default' => 'array',
            'sperky.base_url' => self::BASE,
            'sperky.api_key' => 'fake-key-orders-read-DO-NOT-USE',
            'sperky.attempts' => 1,
            'sperky.backoff_ms' => 0,
            'sperky.per_page.max' => 100,
            'sperky.per_page.default' => 20,
            'sperky.cache.ttl.list' => 300,
            'sperky.cache.ttl.detail' => 900,
            'sperky.countries' => ['SK', 'HU'],
            'sperky.aggregate.per_page' => 100,
            'sperky.aggregate.revenue_max_requests' => 10,
            'sperky.aggregate.sleep_ms' => 0,
            'sperky.aggregate.area' => 'Biznis & projekty',
            'sperky.aggregate.department' => 'E-shop',
        ]);

        Area::create(['name' => 'Biznis & projekty', 'slug' => 'biznis-projekty', 'color' => '#2f6d8f', 'angle' => 126]);
    }

    /**
     * Júl 2026: tri objednávky, dve meny. Filtrovaný dopyt bez `country` vracia
     * celé okno, dopyt s `country` len počet pre krajinu (rozhodnutie 3).
     */
    private function fakeJuly(): void
    {
        Http::fake([self::BASE.'/api/order*' => function ($request) {
            parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $query);
            $country = $query['country'] ?? null;

            if ($country !== null) {
                $totals = ['SK' => 1, 'HU' => 1];

                return Http::response(['result' => [
                    'orders' => [], 'page' => 1, 'per_page' => 1, 'total' => $totals[$country] ?? 0,
                ]]);
            }

            return Http::response(['result' => [
                'orders' => [
                    ['id' => 30, 'date_add' => '2026-07-20 10:00:00', 'total_paid' => '100.00', 'currency' => 'EUR'],
                    ['id' => 29, 'date_add' => '2026-07-19 10:00:00', 'total_paid' => '11215', 'currency' => 'HUF'],
                    ['id' => 28, 'date_add' => '2026-07-18 10:00:00', 'total_paid' => '20.50', 'currency' => 'EUR'],
                ],
                'page' => 1,
                'per_page' => 100,
                'total' => 3,
            ]]);
        }]);
    }

    public function test_agregat_vytvori_uzol_s_presnymi_poctami_a_obratom_po_menach(): void
    {
        $this->fakeJuly();

        $this->artisan('sperky:aggregate', ['--month' => '2026-07'])->assertSuccessful();

        $node = Node::where('external_key', 'sperky:month:2026-07')->first();

        $this->assertNotNull($node);
        $this->assertSame('memory', $node->type);
        $this->assertSame('E-shop Júl 2026', $node->label);
        $this->assertSame('sperky', $node->source);

        $meta = $node->meta;
        // presný počet z `total` filtrovanej odpovede, nie z prejdených strán
        $this->assertSame(3, $meta['orders']);
        $this->assertSame(['from' => '2026-07-01', 'to' => '2026-07-31'], $meta['window']);

        // OBRAT PO MENÁCH — samostatný riadok pre každú menu.
        // assertEquals, nie assertSame: `meta` prechádza JSON stĺpcom a 11215.0
        // sa z neho vráti ako int (json_encode zahodí .0 bez PRESERVE_ZERO_FRACTION).
        $this->assertEquals([
            ['currency' => 'EUR', 'total' => 120.5, 'orders' => 2],
            ['currency' => 'HUF', 'total' => 11215.0, 'orders' => 1],
        ], $meta['revenue']);
        $this->assertTrue($meta['revenue_meta']['complete']);
        $this->assertSame(3, $meta['revenue_meta']['orders_covered']);
    }

    public function test_krajiny_su_presne_a_bez_priznakov_o_vzorke(): void
    {
        $this->fakeJuly();
        $this->artisan('sperky:aggregate', ['--month' => '2026-07'])->assertSuccessful();

        $meta = Node::where('external_key', 'sperky:month:2026-07')->firstOrFail()->meta;

        $this->assertSame(
            [['country_iso' => 'SK', 'orders' => 1], ['country_iso' => 'HU', 'orders' => 1]],
            $meta['countries'],
        );
        // 3 v okne − 1 SK − 1 HU. POČTY sa sčítavať smú.
        $this->assertSame(1, $meta['countries_other']);

        // Rozhodnutie 3 a 7: žiadna vzorka, žiadny odhad meny.
        $serialized = (string) json_encode($meta, JSON_UNESCAPED_UNICODE);
        $this->assertStringNotContainsString('sample', $serialized);
        $this->assertStringNotContainsString('currency_is_estimate', $serialized);
        $this->assertStringNotContainsString('currency_estimate', $serialized);
        $this->assertArrayNotHasKey('countries_meta', $meta);
    }

    public function test_uzol_neobsahuje_ziadne_cislo_napriec_menami(): void
    {
        $this->fakeJuly();
        $this->artisan('sperky:aggregate', ['--month' => '2026-07'])->assertSuccessful();

        $node = Node::where('external_key', 'sperky:month:2026-07')->firstOrFail();
        $serialized = json_encode($node->meta, JSON_UNESCAPED_UNICODE).'|'.$node->description;

        // 100 EUR + 11 215 HUF = 11 315 a 100 + 20,50 + 11 215 = 11 335,50
        $this->assertStringNotContainsString(self::FORBIDDEN_SUM, str_replace([' ', ' '], '', $serialized));
        $this->assertStringNotContainsString('11 315', $serialized);
        $this->assertStringNotContainsString(self::FORBIDDEN_SUM_ALL, str_replace([' ', ' '], '', $serialized));

        // Silnejšie než zoznam zakázaných názvov kľúčov: žiadna číselná hodnota
        // v uzle sa nesmie rovnať súčtu naprieč menami.
        $this->assertNoValueEquals($node->meta, [11315.0, 11335.5]);

        // `revenue` smie byť len ZOZNAM riadkov, každý s vlastnou menou —
        // skalárne „revenue: 11315" by túto kontrolu neprešlo.
        $this->assertIsList($node->meta['revenue']);
        foreach ($node->meta['revenue'] as $row) {
            $this->assertArrayHasKey('currency', $row);
            $this->assertMatchesRegularExpression('/^[A-Z]{3}$/', $row['currency']);
        }

        $this->assertTrue($node->meta['cross_currency_sum_forbidden']);
        $this->assertStringContainsString('nesčítavajú naprieč menami', $node->description);
        $this->assertStringContainsString('Obrat po menách:', $node->description);
    }

    public function test_druhy_beh_nevytvori_duplikat(): void
    {
        $this->fakeJuly();

        $this->artisan('sperky:aggregate', ['--month' => '2026-07'])->assertSuccessful();
        $first = Node::where('external_key', 'sperky:month:2026-07')->firstOrFail();

        $this->artisan('sperky:aggregate', ['--month' => '2026-07'])->assertSuccessful();

        $this->assertSame(1, Node::where('external_key', 'sperky:month:2026-07')->count());
        $this->assertSame($first->id, Node::where('external_key', 'sperky:month:2026-07')->firstOrFail()->id);
        // popis sa PREPÍŠE, nenaskladá sa do seba
        $this->assertSame(
            substr_count($first->description, 'Obrat po menách'),
            substr_count(Node::find($first->id)->description, 'Obrat po menách'),
        );
    }

    public function test_uzol_ide_do_oblasti_biznis_a_oddelenia_eshop(): void
    {
        $this->fakeJuly();
        $this->artisan('sperky:aggregate', ['--month' => '2026-07'])->assertSuccessful();

        $node = Node::where('external_key', 'sperky:month:2026-07')->firstOrFail();
        $area = Area::findOrFail($node->area_id);
        $department = Department::findOrFail($node->department_id);

        $this->assertSame('Biznis & projekty', $area->name);
        $this->assertSame('E-shop', $department->name);
        $this->assertSame($area->id, $department->area_id);
    }

    public function test_dry_run_nezapisuje(): void
    {
        $this->fakeJuly();

        $this->artisan('sperky:aggregate', ['--month' => '2026-07', '--dry-run' => true])->assertSuccessful();

        $this->assertSame(0, Node::where('external_key', 'sperky:month:2026-07')->count());
    }

    public function test_nahrobok_zabrani_znovu_adopcii_kluca(): void
    {
        Tombstone::create(['external_key' => 'sperky:month:2026-07', 'reason' => 'merge']);
        $this->fakeJuly();

        $this->artisan('sperky:aggregate', ['--month' => '2026-07'])->assertFailed();

        $this->assertSame(0, Node::where('external_key', 'sperky:month:2026-07')->count());
    }

    public function test_pri_rate_limite_sa_uzol_nezapise(): void
    {
        // Beh skončí elegantne (bez výnimky), ale nepravdivý „0 objednávok"
        // uzol nevznikne — chýbajúci počet nie je nula.
        Http::fake([self::BASE.'/api/order*' => Http::response(['error' => 'rate_limited'], 200)]);

        $this->artisan('sperky:aggregate', ['--month' => '2026-07'])->assertFailed();

        $this->assertSame(0, Node::where('external_key', 'sperky:month:2026-07')->count());
    }

    public function test_neplatny_mesiac_skonci_chybou_a_nezapise_nic(): void
    {
        $this->fakeJuly();

        $this->artisan('sperky:aggregate', ['--month' => 'júl'])->assertFailed();

        $this->assertSame(0, Node::where('external_key', 'like', 'sperky:month:%')->count());
    }

    public function test_mesiac_stoji_jednu_poziadavku_na_okno_plus_jednu_na_krajinu(): void
    {
        // Rozhodnutie 2: namiesto 40–100 strán zoznamu. Tri objednávky sa zmestia
        // na jednu stranu, ku ktorej pribudnú dva dopyty na krajiny.
        $this->fakeJuly();
        $this->artisan('sperky:aggregate', ['--month' => '2026-07'])->assertSuccessful();

        Http::assertSentCount(3);
        $this->assertSame(3, Node::where('external_key', 'sperky:month:2026-07')->firstOrFail()->meta['requests']);
    }

    /**
     * Žiadna číselná hodnota (rekurzívne) sa nerovná zakázanému súčtu.
     *
     * @param  array<mixed>  $data
     * @param  list<float>  $forbidden
     */
    private function assertNoValueEquals(array $data, array $forbidden): void
    {
        foreach ($data as $key => $value) {
            if (is_array($value)) {
                $this->assertNoValueEquals($value, $forbidden);

                continue;
            }

            if (! is_numeric($value)) {
                continue;
            }

            foreach ($forbidden as $sum) {
                $this->assertNotEquals(
                    $sum,
                    (float) $value,
                    "kľúč '{$key}' obsahuje súčet naprieč menami ({$sum}) — to je zakázané číslo",
                );
            }
        }
    }
}
