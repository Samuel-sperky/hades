<?php

namespace Tests\Feature;

use App\Models\Edge;
use App\Models\Node;
use App\Services\MindService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Regresia 12.8.2026: mind:rewire (~O(n²), cez 55 minút pri 2 587 uzloch) si drží
 * kolekciu uzlov v pamäti od svojho štartu. Keď mu mind:automerge medzitým zlúčil
 * a zmazal uzol, MindService::connect() vrazil do FK constraintu
 * edges_target_id_foreign a zhodil CELÝ beh (exit 1). Similarity hrany sa prestali
 * dopĺňať, kým cleanup-edges a prune-coactivation ich ďalej mazali — sieť klesla
 * zo 17 207 na 7 877 hrán za jeden deň.
 *
 * Fix má dve vrstvy: poradie jobov v routes/console.php (rewire je posledný) a
 * kontrola existencie uzla priamo v connect(), ktorá je testovaná tu.
 */
class ConnectResilienceTest extends TestCase
{
    use RefreshDatabase;

    private MindService $mind;

    protected function setUp(): void
    {
        parent::setUp();

        config(['cache.default' => 'array']);

        $this->mind = app(MindService::class);
    }

    private function node(string $label, string $type = 'skill'): Node
    {
        return Node::create(['type' => $type, 'label' => $label, 'strength' => 1]);
    }

    public function test_connect_creates_edge_between_two_live_nodes(): void
    {
        $a = $this->node('Docker Compose');
        $b = $this->node('MariaDB');

        $edge = $this->mind->connect($a, $b, 'similarity', true, 0.5);

        $this->assertNotNull($edge);
        $this->assertSame('similarity', $edge->kind);
        $this->assertSame(0.5, (float) $edge->weight);
        $this->assertSame(1, Edge::count());
    }

    public function test_connect_normalises_pair_order_by_id(): void
    {
        $a = $this->node('Prvý');
        $b = $this->node('Druhý');

        // volané v opačnom poradí, hrana musí vyjsť rovnako (min → max)
        $edge = $this->mind->connect($b, $a);

        $this->assertNotNull($edge);
        $this->assertSame($a->id, $edge->source_id);
        $this->assertSame($b->id, $edge->target_id);
    }

    public function test_connect_returns_null_when_target_node_vanished(): void
    {
        $a = $this->node('Prežije');
        $b = $this->node('Zlúčený a zmazaný');

        // presne to, čo robí mind:automerge — víťaz pohltí porazeného a ten zmizne.
        // $b ostáva ako model v pamäti rewire, hoci riadok v DB už neexistuje.
        Node::whereKey($b->id)->delete();

        $edge = $this->mind->connect($a, $b, 'similarity', true, 0.5);

        $this->assertNull($edge, 'connect() musí zmiznutý uzol preskočiť, nie padnúť na FK constraint');
        $this->assertSame(0, Edge::count());
    }

    public function test_connect_returns_null_when_source_node_vanished(): void
    {
        $a = $this->node('Zlúčený a zmazaný');
        $b = $this->node('Prežije');

        Node::whereKey($a->id)->delete();

        $this->assertNull($this->mind->connect($a, $b, 'similarity', true, 0.5));
        $this->assertSame(0, Edge::count());
    }

    public function test_connect_still_strengthens_an_existing_edge(): void
    {
        $a = $this->node('Docker Compose');
        $b = $this->node('MariaDB');

        $first = $this->mind->connect($a, $b, 'similarity', true, 0.5);
        $second = $this->mind->connect($a, $b, 'similarity', true, 0.5);

        $this->assertNotNull($second);
        $this->assertSame($first->id, $second->id);
        $this->assertSame(1, Edge::count());
        $this->assertGreaterThan((float) $first->weight, (float) $second->fresh()->weight);
    }

    public function test_rewire_style_loop_survives_a_vanished_node(): void
    {
        $live = $this->node('Hub');
        $doomed = collect(range(1, 3))->map(fn (int $i) => $this->node("Zmazaný {$i}"));
        $survivors = collect(range(1, 2))->map(fn (int $i) => $this->node("Živý {$i}"));

        // kolekcia načítaná "na začiatku behu"
        $snapshot = $doomed->concat($survivors);

        // automerge zasiahne uprostred behu
        Node::whereIn('id', $doomed->pluck('id'))->delete();

        $created = 0;
        foreach ($snapshot as $other) {
            if ($this->mind->connect($live, $other, 'similarity', true, 0.5)) {
                $created++;
            }
        }

        $this->assertSame(2, $created, 'beh musí dokončiť živé uzly, nie skončiť na prvom zmazanom');
        $this->assertSame(2, Edge::count());
    }
}
