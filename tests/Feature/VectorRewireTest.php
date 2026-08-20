<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Edge;
use App\Models\Node;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Vektorová cesta similarity kroku v `mind:rewire` (`--vector`) a jej suchý beh
 * (`--dry-run`).
 *
 * Vektory sa tu zapisujú PRIAMO do `node_embeddings` a model sa nefakeuje vôbec:
 * `Http::preventStrayRequests()` bez jediného stubu znamená, že akýkoľvek pokus
 * o sieť test zhodí. To je časť kontraktu, nie lenivosť — vektorová cesta číta
 * len hotové vektory, takže spadnutá Ollama ju nemá čím trápiť.
 *
 * Vektory sú štvorrozmerné a zvolené ako jednotkové vektory na kružnici, takže
 * kosínus každého páru je `cos(rozdiel uhlov)` a správne poradie aj počty sú
 * známe DOPREDU z konštrukcie, nie odvodené z toho, čo príkaz vypíše.
 *
 * Najdôležitejšie, čo tento test drží, nie je vektorová cesta, ale jej ABSENCIA:
 * `mind:rewire` chodí nočným plánovačom nad živou pamäťou a keď sú embeddingy
 * vypnuté alebo korpus nevektorizovaný, musí urobiť presne to, čo robil pred
 * touto zmenou. Preto sa TF-IDF výsledok a výsledok `--vector` s vypnutými
 * embeddingmi porovnávajú číslo na číslo nad tou istou databázou.
 */
class VectorRewireTest extends TestCase
{
    use RefreshDatabase;

    /** Prah, pod ktorý padnú práve tri páry vzorky (A–B, B–C, D–E). */
    private const FLOOR_THREE = '0.90';

    /** Prah, pod ktorý padnú práve dva páry (A–B, D–E). */
    private const FLOOR_TWO = '0.95';

    private Area $area;

    /** @var array<string, Node> */
    private array $nodes = [];

    protected function setUp(): void
    {
        parent::setUp();

        // Vektorová cesta nesmie siahnuť na model — akýkoľvek request je chyba.
        Http::preventStrayRequests();

        config([
            'hades.embeddings.enabled' => true,
            'hades.embeddings.model' => 'fake-embed',
        ]);

        $this->area = Area::create([
            'name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0,
        ]);

        // Jednoslovné labely bez zdieľaných tokenov: TF-IDF ich nespojí a ani
        // kroky A5–A8 nemajú z čoho postaviť most, takže vo výsledku je vidieť
        // výhradne to, čo urobil similarity krok.
        foreach (['Alfa' => 0, 'Beta' => 10, 'Gama' => 30, 'Delta' => 80, 'Epsilon' => 90] as $label => $degrees) {
            $radians = deg2rad($degrees);
            $this->nodes[$label] = $this->node($label);
            $this->storeVector($this->nodes[$label], [cos($radians), sin($radians), 0.0, 0.0]);
        }

        // Dvojica, ktorú spojí LEN TF-IDF: popisy sú takmer totožné, ale vektory
        // sú na seba kolmé. Bez nej by sa parita porovnávala nuly s nulami.
        $body = 'kontajner kontajner migracia migracia fronta';
        $this->nodes['Zeta'] = $this->node('Zeta', $body);
        $this->storeVector($this->nodes['Zeta'], [0.0, 0.0, 1.0, 0.0]);
        $this->nodes['Omega'] = $this->node('Omega', $body);
        $this->storeVector($this->nodes['Omega'], [0.0, 0.0, 0.0, 1.0]);
    }

    public function test_prah_urcuje_kolko_hran_by_vzniklo(): void
    {
        // cos 10° = 0,985 · cos 20° = 0,940 · cos 30° = 0,866 · cos 10° (D–E) = 0,985
        $this->assertSame(3, $this->dryRunVector(self::FLOOR_THREE));
        $this->assertSame(2, $this->dryRunVector(self::FLOOR_TWO));
    }

    public function test_nedosiahnutelny_prah_nenavrhne_nic(): void
    {
        $this->assertSame(0, $this->dryRunVector('1.01'));
    }

    public function test_dry_run_nezapise_ani_riadok_a_je_reprodukovatelny(): void
    {
        $nodesBefore = Node::count();
        $edgesBefore = Edge::count();

        $first = $this->dryRunVector(self::FLOOR_THREE);
        $second = $this->dryRunVector(self::FLOOR_THREE);

        $this->assertSame(3, $first);
        $this->assertSame($first, $second, 'Dva rovnaké dry-run behy musia dať to isté číslo.');
        $this->assertSame($nodesBefore, Node::count());
        $this->assertSame($edgesBefore, Edge::count());
    }

    public function test_uz_prepojene_pary_sa_nenavrhuju_znova(): void
    {
        // A–B je najsilnejší pár vzorky; keď hranu už má, ostávajú B–C a D–E
        Edge::create([
            'source_id' => min($this->nodes['Alfa']->id, $this->nodes['Beta']->id),
            'target_id' => max($this->nodes['Alfa']->id, $this->nodes['Beta']->id),
            'weight' => 1.0,
            'kind' => 'manual',
            'auto' => false,
        ]);

        $this->assertSame(2, $this->dryRunVector(self::FLOOR_THREE));
    }

    public function test_zapisovy_beh_vytvori_prave_navrhnute_hrany_a_je_idempotentny(): void
    {
        $planned = $this->dryRunVector(self::FLOOR_TWO);
        $this->assertSame(2, $planned);

        Artisan::call('mind:rewire', ['--vector' => true, '--floor' => self::FLOOR_TWO]);

        $this->assertTrue($this->edgeExists('Alfa', 'Beta'));
        $this->assertTrue($this->edgeExists('Delta', 'Epsilon'));
        $this->assertFalse($this->edgeExists('Beta', 'Gama'), 'Pár pod prahom nesmie vzniknúť.');
        $this->assertSame(2, Edge::count(), 'Vzniknúť majú presne tie hrany, ktoré dry-run nahlásil.');
        $this->assertSame('similarity', Edge::first()->kind);

        // druhý beh už nemá čo pridať
        $this->assertSame(0, $this->dryRunVector(self::FLOOR_TWO));
    }

    public function test_vypnute_embeddingy_znamenaju_povodnu_tfidf_cestu(): void
    {
        $tfidf = $this->dryRun([]);

        // bez `--floor`, teda tak, ako to spustí nočný plánovač: prah musí spadnúť
        // na pôvodných 0,20, nie na vektorových 0,70
        config(['hades.embeddings.enabled' => false]);
        $fallback = $this->dryRun(['--vector' => true]);

        $this->assertSame(1, $tfidf['count'], 'TF-IDF má spojiť práve dvojicu Zeta–Omega.');
        $this->assertStringContainsString('TF-IDF, prah 0.20', $tfidf['output']);
        $this->assertSame($tfidf['count'], $fallback['count']);
        $this->assertStringContainsString('TF-IDF, prah 0.20', $fallback['output']);
        $this->assertStringNotContainsString('vektory', $fallback['output']);

        // a že to naozaj nie je tá istá cesta v prezlečení: vektory dajú iné číslo
        config(['hades.embeddings.enabled' => true]);
        $this->assertSame(3, $this->dryRunVector(self::FLOOR_THREE));
    }

    public function test_prazdny_korpus_vektorov_padne_spat_na_tfidf(): void
    {
        DB::table('node_embeddings')->delete();

        $result = $this->dryRun(['--vector' => true]);

        $this->assertStringContainsString('TF-IDF, prah 0.20', $result['output']);
        $this->assertSame(1, $result['count']);
    }

    public function test_vektor_inej_dimenzie_sa_preskoci(): void
    {
        // uzol s 3-rozmerným vektorom pod tým istým modelom: skalárny súčin s
        // 4-rozmernými je nezmysel, takže sa nesmie dostať do korpusu
        $odd = $this->node('Theta');
        $this->storeVector($odd, [1.0, 0.0, 0.0]);

        $this->assertSame(3, $this->dryRunVector(self::FLOOR_THREE));
        $this->assertSame(0, Edge::where('source_id', $odd->id)->orWhere('target_id', $odd->id)->count());
    }

    private function node(string $label, string $description = ''): Node
    {
        return Node::create([
            'type' => 'skill',
            'label' => $label,
            'description' => $description,
            'area_id' => $this->area->id,
            'strength' => 1,
        ]);
    }

    /** @param  array<int, float>  $vector */
    private function storeVector(Node $node, array $vector): void
    {
        $norm = sqrt(array_sum(array_map(fn ($v) => $v * $v, $vector)));

        DB::table('node_embeddings')->insert([
            'node_id' => $node->id,
            'model' => 'fake-embed',
            'dimensions' => count($vector),
            'vector' => pack('g*', ...$vector),
            'norm' => $norm,
            'source_hash' => hash('sha256', $node->label),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function dryRunVector(string $floor): int
    {
        return $this->dryRun(['--vector' => true, '--floor' => $floor])['count'];
    }

    /**
     * @param  array<string, mixed>  $options
     * @return array{count: int, output: string}
     */
    private function dryRun(array $options): array
    {
        Artisan::call('mind:rewire', $options + ['--dry-run' => true]);
        $output = Artisan::output();

        // číslo sa číta z hlásenia príkazu, nie z počtu hrán — dry-run žiadne
        // nevytvorí a práve to je predmet testu
        preg_match('/(\d+) similarity hrán BY vzniklo/u', $output, $m);
        $this->assertNotEmpty($m, "Dry-run nenahlásil počet:\n{$output}");

        return ['count' => (int) $m[1], 'output' => $output];
    }

    private function edgeExists(string $a, string $b): bool
    {
        $ids = [$this->nodes[$a]->id, $this->nodes[$b]->id];

        return Edge::where('source_id', min($ids))->where('target_id', max($ids))->exists();
    }
}
