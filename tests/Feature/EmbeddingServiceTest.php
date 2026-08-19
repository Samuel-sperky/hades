<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Department;
use App\Models\Node;
use App\Models\Tag;
use App\Services\EmbeddingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use RuntimeException;
use Tests\TestCase;

/**
 * Vektorová vetva recallu bez modelu.
 *
 * Model je tu fake s deterministickými vektormi — inak by test meral CPU
 * inferenciu (sekundy na uzol) a jeho výsledok by závisel od toho, ktorý model je
 * práve stiahnutý. Vektory sú 4-rozmerné a ručne zvolené tak, aby bolo správne
 * poradie známe dopredu, nie odvodené z toho, čo služba vráti.
 */
class EmbeddingServiceTest extends TestCase
{
    use RefreshDatabase;

    private EmbeddingService $embeddings;

    private Area $area;

    /** Jednotkové vektory, pri ktorých je kosínus voči [1,0,0,0] vidieť z hlavy. */
    private const V_DOCKER = [1.0, 0.0, 0.0, 0.0];   // podobnosť 1,0

    private const V_LARAVEL = [0.6, 0.8, 0.0, 0.0];  // podobnosť 0,6

    private const V_KVETY = [0.0, 0.0, 0.0, 1.0];    // podobnosť 0,0

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'hades.embeddings.enabled' => true,
            'hades.embeddings.model' => 'fake-embed',
            'hades.embeddings.batch' => 2,
            'hades.embeddings.candidates' => 10,
            'hades.embeddings.min_similarity' => 0.35,
            'hades.console.ollama.host' => 'http://ollama.test:11434',
            'hades.console.ollama.timeout' => 5,
        ]);

        $this->embeddings = app(EmbeddingService::class);

        $this->area = Area::create([
            'name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0,
        ]);
    }

    /** @var array<string, array<int, float>|null> */
    private array $vectorMap = [];

    /** @var array<int, float> */
    private array $vectorDefault = self::V_DOCKER;

    private bool $faked = false;

    /**
     * Fake modelu: vektor sa vyberá podľa toho, čo je vo vstupnom texte. `null`
     * ako hodnota znamená chybu modelu pre daný vstup.
     *
     * Pasca: `Http::fake()` sa NEDÁ zavolať druhý raz s inou odpoveďou —
     * registruje ďalší stub a vyhrá ten prvý, ktorý odpoveď vráti. Preto je stub
     * jeden a mapa žije v properte, ktorú test prepisuje.
     *
     * @param  array<string, array<int, float>|null>  $map
     * @param  array<int, float>  $default
     */
    private function fakeModel(array $map = [], array $default = self::V_DOCKER): void
    {
        $this->vectorMap = $map;
        $this->vectorDefault = $default;

        if ($this->faked) {
            return;
        }

        $this->faked = true;

        Http::preventStrayRequests();

        Http::fake(function (Request $request) {
            $input = (string) ($request->data()['input'] ?? '');

            foreach ($this->vectorMap as $needle => $vector) {
                if (str_contains($input, (string) $needle)) {
                    return $vector === null
                        ? Http::response(['error' => 'model not found'], 404)
                        : Http::response(['embeddings' => [$vector]]);
                }
            }

            return Http::response(['embeddings' => [$this->vectorDefault]]);
        });
    }

    private function node(string $label, string $description = '', array $tags = []): Node
    {
        $node = Node::create([
            'type' => 'skill',
            'label' => $label,
            'description' => $description,
            'area_id' => $this->area->id,
            'strength' => 1,
        ]);

        foreach ($tags as $name) {
            $node->tags()->attach(Tag::firstOrCreate(['name' => $name], ['slug' => str($name)->slug()]));
        }

        return $node->fresh();
    }

    /** @return array<int, float> */
    private function storedVector(Node $node): array
    {
        $row = DB::table('node_embeddings')->where('node_id', $node->id)->first();

        return array_values(unpack('g*', (string) $row->vector));
    }

    public function test_pack_unpack_round_trips_a_vector_exactly(): void
    {
        // Zámerne binárne zlomky: float32 ich drží presne, takže test meria
        // round-trip a nie zaokrúhľovanie. Netriviálna hodnota má vlastnú
        // toleranciu nižšie — 0,1 sa v float32 uložiť presne NEDÁ a test, ktorý
        // by to tvrdil, by bol len falošne zelený niekde inde.
        $exact = [0.5, -0.25, 0.0625, 1.0];
        $this->fakeModel(default: $exact);

        $node = $this->node('Docker');
        $this->embeddings->embedNode($node);

        $this->assertSame($exact, $this->storedVector($node));

        $this->fakeModel(default: [0.1, 0.2, 0.3, 0.4]);
        $this->embeddings->embedNode($node->fresh());

        foreach ([0.1, 0.2, 0.3, 0.4] as $i => $expected) {
            $this->assertEqualsWithDelta($expected, $this->storedVector($node)[$i], 1e-7);
        }
    }

    public function test_search_orders_hits_by_cosine_similarity(): void
    {
        $this->fakeModel([
            'Docker' => self::V_DOCKER,
            'Laravel' => self::V_LARAVEL,
            'Kvety' => self::V_KVETY,
        ]);

        $docker = $this->node('Docker');
        $laravel = $this->node('Laravel');
        $kvety = $this->node('Kvety na balkóne');

        $this->embeddings->embedNodes([$docker, $laravel, $kvety]);

        // dopyt netrafí žiadny needle → default = V_DOCKER
        $hits = $this->embeddings->search('ako spustím kontejner', 10, 0.0);

        $this->assertSame(
            [$docker->id, $laravel->id, $kvety->id],
            array_column($hits, 'node_id'),
        );
        $this->assertSame(1.0, $hits[0]['similarity']);
        $this->assertEqualsWithDelta(0.6, $hits[1]['similarity'], 1e-6);
        $this->assertEqualsWithDelta(0.0, $hits[2]['similarity'], 1e-6);
    }

    public function test_min_similarity_floor_drops_weak_hits(): void
    {
        $this->fakeModel([
            'Docker' => self::V_DOCKER,
            'Laravel' => self::V_LARAVEL,
            'Kvety' => self::V_KVETY,
        ]);

        $docker = $this->node('Docker');
        $laravel = $this->node('Laravel');
        $kvety = $this->node('Kvety na balkóne');
        $this->embeddings->embedNodes([$docker, $laravel, $kvety]);

        // default z konfigurácie (0,35) zhodí len nulovú zhodu
        $this->assertSame(
            [$docker->id, $laravel->id],
            array_column($this->embeddings->search('ako spustím kontejner'), 'node_id'),
        );

        // prah nad 0,6 nechá len presnú zhodu
        $this->assertSame(
            [$docker->id],
            array_column($this->embeddings->search('ako spustím kontejner', 10, 0.7), 'node_id'),
        );
    }

    public function test_unchanged_node_is_skipped_and_changed_label_is_reembedded(): void
    {
        $this->fakeModel();
        $node = $this->node('Docker', 'Kontejnery a rebuild.');

        $this->assertSame([$node->id], $this->embeddings->staleNodeIds());

        $first = $this->embeddings->embedNodes([$node]);
        $this->assertSame(1, $first['embedded']);
        Http::assertSentCount(1);

        // druhý beh nad nezmeneným uzlom nesmie volať model vôbec
        $this->assertSame([], $this->embeddings->staleNodeIds());
        $second = $this->embeddings->embedNodes([$node->fresh()]);
        $this->assertSame(['embedded' => 0, 'skipped' => 1, 'failed' => 0, 'errors' => []], $second);
        Http::assertSentCount(1);

        $node->update(['label' => 'Docker Compose']);

        $this->assertSame([$node->id], $this->embeddings->staleNodeIds());
        $third = $this->embeddings->embedNodes([$node->fresh()]);
        $this->assertSame(1, $third['embedded']);
        Http::assertSentCount(2);

        // stále jeden riadok na (uzol, model) — upsert, nie ďalší vektor
        $this->assertSame(1, DB::table('node_embeddings')->where('node_id', $node->id)->count());
    }

    public function test_force_deleted_node_takes_its_embedding_with_it(): void
    {
        $this->fakeModel();
        $node = $this->node('Docker');
        $this->embeddings->embedNode($node);

        $this->assertDatabaseCount('node_embeddings', 1);

        $node->forceDelete();

        $this->assertDatabaseCount('node_embeddings', 0);
    }

    public function test_soft_deleted_node_is_not_returned_by_search(): void
    {
        $this->fakeModel();
        $node = $this->node('Docker');
        $this->embeddings->embedNode($node);

        $node->delete();

        // vektor prežíva (cascade patrí forceDelete), ale hľadanie ho nesmie vrátiť —
        // inak by konzument dostal id, ktoré si nikdy nenačíta
        $this->assertDatabaseCount('node_embeddings', 1);
        $this->assertSame([], $this->embeddings->search('ako spustím kontejner', 10, 0.0));
    }

    public function test_dimensions_come_from_the_model_and_a_mismatch_does_not_corrupt_storage(): void
    {
        $this->fakeModel();
        $short = $this->node('Docker');
        $this->embeddings->embedNode($short);

        // ten istý názov modelu, iná dimenzia odpovede (v praxi: pretag/výmena
        // modelu pod rovnakým menom). Riadok musí zostať celý a správne dlhý.
        $eight = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
        $this->fakeModel(default: $eight);
        $long = $this->node('Laravel');
        $this->embeddings->embedNode($long);

        $this->assertSame(4, (int) DB::table('node_embeddings')->where('node_id', $short->id)->value('dimensions'));
        $this->assertSame(8, (int) DB::table('node_embeddings')->where('node_id', $long->id)->value('dimensions'));
        $this->assertSame($eight, $this->storedVector($long));

        // 4-rozmerný dopyt nesmie 8-rozmerný riadok ani spadnúť, ani skórovať
        $this->fakeModel(default: self::V_DOCKER);
        $hits = $this->embeddings->search('ako spustím kontejner', 10, 0.0);

        $this->assertSame([$short->id], array_column($hits, 'node_id'));
    }

    public function test_batch_survives_a_failing_node_and_reports_it(): void
    {
        $this->fakeModel(['Zlomený' => null]);

        $ok = $this->node('Docker');
        $broken = $this->node('Zlomený uzol');
        $also = $this->node('Laravel');

        $stats = $this->embeddings->embedNodes([$ok, $broken, $also]);

        $this->assertSame(2, $stats['embedded']);
        $this->assertSame(1, $stats['failed']);
        $this->assertArrayHasKey($broken->id, $stats['errors']);
        $this->assertStringContainsString('404', $stats['errors'][$broken->id]);

        // hotová práca zostáva zapísaná a zvyšok je stále „stale" — beh je obnoviteľný
        $this->assertDatabaseCount('node_embeddings', 2);
        $this->assertSame([$broken->id], $this->embeddings->staleNodeIds());
    }

    public function test_single_call_fails_loudly_when_the_model_answers_with_an_error(): void
    {
        $this->fakeModel(['Docker' => null]);
        $node = $this->node('Docker');

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('model not found');

        $this->embeddings->embedNode($node);
    }

    public function test_search_does_not_call_the_model_on_an_empty_corpus(): void
    {
        $this->fakeModel();
        $this->node('Docker');

        $this->assertSame([], $this->embeddings->search('ako spustím kontejner'));

        Http::assertNothingSent();
    }

    public function test_text_for_node_leads_with_the_label_and_caps_the_description(): void
    {
        $department = Department::create([
            'area_id' => $this->area->id, 'name' => 'Backend', 'slug' => 'backend',
        ]);

        $node = $this->node('Docker rebuild', str_repeat('popis ', 400), ['zeta', 'alfa']);
        $node->update(['department_id' => $department->id]);
        $node = $node->fresh(['tags', 'area', 'department']);

        $text = $this->embeddings->textFor($node);
        $lines = explode("\n", $text);

        $this->assertSame('Docker rebuild', $lines[0]);
        $this->assertSame('Oblasť: Vývoj & kód / Backend', $lines[1]);
        // tagy abecedne, inak by sa `source_hash` menil podľa poradia z DB
        $this->assertSame('Tagy: alfa, zeta', $lines[2]);
        $this->assertLessThanOrEqual(EmbeddingService::DESC_CAP + 1, mb_strlen($lines[3]));
        $this->assertStringEndsWith('…', $lines[3]);
    }

    public function test_command_is_resumable_and_honours_limit(): void
    {
        $this->fakeModel();
        $this->node('Docker');
        $this->node('Laravel');
        $this->node('Kvety na balkóne');

        $this->artisan('mind:embed --limit=2')->assertExitCode(0);
        $this->assertDatabaseCount('node_embeddings', 2);

        // druhý beh dorobí len zvyšok, hotové uzly znovu nevolá
        Http::assertSentCount(2);
        $this->artisan('mind:embed')->assertExitCode(0);
        $this->assertDatabaseCount('node_embeddings', 3);
        Http::assertSentCount(3);

        // tretí beh nemá čo robiť
        $this->artisan('mind:embed')->assertExitCode(0);
        Http::assertSentCount(3);
    }
}
