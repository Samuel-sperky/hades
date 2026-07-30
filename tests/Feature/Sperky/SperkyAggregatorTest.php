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
 * Mesačný agregát: idempotencia, zastavenie na hranici okna a — najdôležitejšie —
 * že v uzle NIKDY nevznikne jeden súhrnný obrat naprieč menami (nález N1).
 *
 * Žiadne volanie na produkciu: všetko cez Http::fake(), kľúč je fiktívny.
 */
class SperkyAggregatorTest extends TestCase
{
    use RefreshDatabase;

    private const BASE = 'https://shop.test';

    /** SK 100 EUR + HU 11215 HUF. Ich súčet (11315) sa nesmie objaviť NIKDE. */
    private const FORBIDDEN_SUM = '11315';

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
            'sperky.currencies' => ['SK' => 'EUR', 'CZ' => 'CZK', 'HU' => 'HUF'],
            'sperky.aggregate.per_page' => 3,
            'sperky.aggregate.max_requests' => 10,
            'sperky.aggregate.sleep_ms' => 0,
            'sperky.aggregate.sample_details' => 3,
            'sperky.aggregate.area' => 'Biznis & projekty',
            'sperky.aggregate.department' => 'E-shop',
        ]);

        Area::create(['name' => 'Biznis & projekty', 'slug' => 'biznis-projekty', 'color' => '#2f6d8f', 'angle' => 126]);
    }

    /** Júl 2026: dve objednávky v okne, tretia (júnová) scan ukončí. */
    private function fakeJuly(): void
    {
        Http::fake([
            self::BASE.'/api/order/get*' => function ($request) {
                parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $query);

                $details = [
                    30 => ['id' => 30, 'total_paid' => '100.00', 'country' => 'Slovensko', 'country_iso' => 'SK', 'product_ids' => [22, 23]],
                    29 => ['id' => 29, 'total_paid' => '11215', 'country' => 'Maďarsko', 'country_iso' => 'HU', 'product_ids' => [22]],
                ];

                $detail = $details[(int) ($query['id'] ?? 0)] ?? null;

                return $detail === null
                    ? Http::response(['result' => ['ok' => false, 'error' => 'not found']])
                    : Http::response(['result' => ['ok' => true] + $detail]);
            },
            self::BASE.'/api/order*' => Http::response(['result' => [
                'orders' => [
                    ['id' => 30, 'date_add' => '2026-07-20 10:00:00', 'total_paid' => '100.00'],
                    ['id' => 29, 'date_add' => '2026-07-19 10:00:00', 'total_paid' => '11215'],
                    ['id' => 28, 'date_add' => '2026-06-30 10:00:00', 'total_paid' => '50.00'],
                ],
                'page' => 1,
                'per_page' => 3,
                'total' => 1763711,
            ]]),
        ]);
    }

    public function test_agregat_vytvori_uzol_s_poctami_a_rozpadom_podla_krajin(): void
    {
        $this->fakeJuly();

        $this->artisan('sperky:aggregate', ['--month' => '2026-07'])->assertSuccessful();

        $node = Node::where('external_key', 'sperky:month:2026-07')->first();

        $this->assertNotNull($node);
        $this->assertSame('memory', $node->type);
        $this->assertSame('E-shop Júl 2026', $node->label);
        $this->assertSame('sperky', $node->source);

        $meta = $node->meta;
        $this->assertSame(2, $meta['orders'], 'júnová objednávka sa do júla nesmie počítať');
        $this->assertTrue($meta['orders_complete']);
        $this->assertSame(1763711, $meta['total_orders_in_shop']);

        $byIso = collect($meta['countries'])->keyBy('country_iso');
        $this->assertSame(1, $byIso['SK']['orders']);
        $this->assertEquals(100.0, $byIso['SK']['total_paid']);
        $this->assertSame('EUR', $byIso['SK']['currency_estimate']);
        $this->assertEquals(11215.0, $byIso['HU']['total_paid']);
        $this->assertSame('HUF', $byIso['HU']['currency_estimate']);
        $this->assertTrue($byIso['HU']['currency_is_estimate']);
    }

    public function test_uzol_neobsahuje_ziadny_suhrnny_obrat_cez_meny(): void
    {
        $this->fakeJuly();
        $this->artisan('sperky:aggregate', ['--month' => '2026-07'])->assertSuccessful();

        $node = Node::where('external_key', 'sperky:month:2026-07')->firstOrFail();
        $serialized = json_encode($node->meta, JSON_UNESCAPED_UNICODE).'|'.$node->description;

        // N1: EUR a HUF sa nikdy nesčítajú a nikdy sa neprepočítajú na jednu menu.
        $this->assertStringNotContainsString(self::FORBIDDEN_SUM, str_replace(' ', '', $serialized));
        $this->assertStringNotContainsString('11 315', $serialized);

        // Žiadny kľúč, ktorý by tváril súhrnný obrat.
        foreach ($this->keysOf($node->meta) as $key) {
            $this->assertDoesNotMatchRegularExpression(
                '/^(revenue|turnover|obrat|total_revenue|total_paid_sum|sum_total)$/i',
                $key,
                "meta nesmie obsahovať kľúč súhrnného obratu: {$key}",
            );
        }

        $this->assertTrue($node->meta['revenue_total_forbidden']);
        $this->assertStringContainsString('ODHADNUTÁ', $node->description);
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
            substr_count($first->description, 'Rozpad podľa krajín'),
            substr_count(Node::find($first->id)->description, 'Rozpad podľa krajín'),
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

    public function test_pri_rate_limite_bez_jedinej_objednavky_sa_uzol_nezapise(): void
    {
        // N5: beh skončí elegantne (bez výnimky), ale nepravdivý „0 objednávok"
        // uzol nevznikne.
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

    public function test_top_produkty_su_zo_vzorky_podla_vyskytu(): void
    {
        $this->fakeJuly();
        $this->artisan('sperky:aggregate', ['--month' => '2026-07'])->assertSuccessful();

        $top = Node::where('external_key', 'sperky:month:2026-07')->firstOrFail()->meta['top_products'];

        $this->assertSame(['id' => 22, 'orders' => 2], $top[0]);
        $this->assertSame(['id' => 23, 'orders' => 1], $top[1]);
    }

    /**
     * Všetky kľúče (rekurzívne) v štruktúre.
     *
     * @param  array<mixed>  $data
     * @return list<string>
     */
    private function keysOf(array $data): array
    {
        $keys = [];
        foreach ($data as $key => $value) {
            if (is_string($key)) {
                $keys[] = $key;
            }
            if (is_array($value)) {
                $keys = array_merge($keys, $this->keysOf($value));
            }
        }

        return $keys;
    }
}
