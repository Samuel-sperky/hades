<?php

namespace Tests\Feature;

use App\Models\Activation;
use App\Models\Area;
use App\Models\Decision;
use App\Models\Department;
use App\Models\Edge;
use App\Models\Node;
use App\Models\Tag;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Brána proti tichej zmene tvaru API odpovedí.
 *
 * Prečo existuje: `/api/v1/*` je zachovaný verzovaný kontrakt a zdieľa controllery
 * s internými `/api/*`. Sprint refaktoruje 22 controllerov a tri god-objecty, takže
 * kľúč sa dá stratiť alebo premenovať bez toho, aby to ktorýkoľvek iný test zachytil.
 *
 * Referenčné tvary v `tests/snapshots/*.shape.json` boli odvodené z PÔVODNÉHO Hadesu
 * s reálnymi 679 uzlami, kým ešte bežal — nie z tejto testovacej DB.
 *
 * Kontrakt testu: každá cesta kľúča zo snapshotu MUSÍ existovať aj v živej odpovedi.
 * Pridanie nového kľúča je dovolené (neláme klienta), odobranie a premenovanie nie.
 */
class PayloadShapeTest extends TestCase
{
    use RefreshDatabase;

    /** Endpointy, ktorých tvar je kontraktom, a súbor s referenčným tvarom. */
    private const CONTRACTS = [
        '/api/mind' => 'mind',
        '/api/mind/stats' => 'mind_stats',
        '/api/dashboard' => 'dashboard',
        '/api/journal' => 'journal',
        '/api/today' => 'today',
        '/api/library' => 'library',
        '/api/structure' => 'structure',
        '/api/activations' => 'activations',
        '/api/decisions' => 'decisions',
        '/api/tags' => 'tags',
        '/api/review/queue' => 'review_queue',
        '/api/duplicates' => 'duplicates',
    ];

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedRepresentativeFixture();
    }

    /**
     * Fixture musí vyplniť KAŽDÝ kľúč kontraktu, inak by test hlásil falošné straty
     * len preto, že testovacia DB je prázdnejšia než produkčná.
     */
    private function seedRepresentativeFixture(): void
    {
        $area = Area::create([
            'name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 342,
        ]);
        $dept = Department::create([
            'area_id' => $area->id, 'name' => 'Backend', 'slug' => 'backend',
        ]);

        $core = Node::create([
            'type' => 'core', 'label' => 'AuraAI', 'description' => 'Jadro vedomia.',
            'strength' => 5, 'pinned' => true, 'last_activated_at' => now(),
        ]);

        $skill = Node::create([
            'type' => 'skill', 'label' => 'Docker Compose', 'description' => 'Kontajnerizácia.',
            'area_id' => $area->id, 'department_id' => $dept->id, 'strength' => 4,
            'origin' => 'brain', 'source' => 'skill', 'certainty' => 'overene',
            'source_file' => 'skills/devops/docker.md', 'source_line' => 12,
            'external_key' => 'skill:docker-compose', 'content_hash' => str_repeat('a', 64),
            'verified_at' => now(), 'last_activated_at' => now(),
            'meta' => ['project' => 'AuraAI', 'tools' => ['Bash' => 3]],
        ]);

        $memory = Node::create([
            'type' => 'memory', 'label' => 'Session záznam', 'description' => 'Popis session.',
            'area_id' => $area->id, 'department_id' => $dept->id, 'strength' => 1,
            'source' => 'session', 'external_key' => 'session:abc123',
            'needs_review' => true, 'last_activated_at' => now(),
            'meta' => ['session_id' => 'abc123', 'prompt_count' => 2],
        ]);

        $project = Node::create([
            'type' => 'project', 'label' => 'AuraAI (refactor)', 'description' => 'Projekt.',
            'area_id' => $area->id, 'strength' => 2, 'last_activated_at' => now(),
        ]);

        // hrany: jedna s relation vyplnenou, jedna s NULL — pokryje nullable úniu
        Edge::create([
            'source_id' => $core->id, 'target_id' => $skill->id, 'weight' => 2,
            'kind' => 'manual', 'auto' => false, 'relation' => 'uses',
            'last_activated_at' => now(),
        ]);
        Edge::create([
            'source_id' => $skill->id, 'target_id' => $memory->id, 'weight' => 0.6,
            'kind' => 'co_activation', 'auto' => true, 'relation' => null,
            'last_activated_at' => now(),
        ]);
        Edge::create([
            'source_id' => $memory->id, 'target_id' => $project->id, 'weight' => 1,
            'kind' => 'similarity', 'auto' => true, 'relation' => 'part_of',
            'last_activated_at' => now(),
        ]);

        // Takmer identická dvojica labelov (similar_text >= 82 %), aby /api/duplicates
        // vrátil aspoň jeden pár — inak by kontrakt kľúčov pairs[].* nemal z čoho vzniknúť.
        Node::create([
            'type' => 'skill', 'label' => 'Vite build pipeline', 'description' => 'Build FE.',
            'area_id' => $area->id, 'department_id' => $dept->id, 'strength' => 1,
            'last_activated_at' => now(),
        ]);
        Node::create([
            'type' => 'skill', 'label' => 'Vite build pipelines', 'description' => 'Build FE 2.',
            'area_id' => $area->id, 'department_id' => $dept->id, 'strength' => 1,
            'last_activated_at' => now(),
        ]);

        $tag = Tag::create(['name' => 'docker']);
        $skill->tags()->attach($tag->id);

        Activation::record($skill, 'activate', 'test-session');
        Activation::record($memory, 'recall', 'test-session');

        Decision::create([
            'node_id' => $project->id, 'area_id' => $area->id, 'decided_on' => now()->toDateString(),
            'text' => 'Embeddingy idú do tohto sprintu.', 'reason' => 'Recall je slabý.',
            'origin' => 'session', 'content_hash' => str_repeat('b', 64),
        ]);
    }

    public function test_no_contract_key_disappeared_from_any_endpoint(): void
    {
        $missingByEndpoint = [];

        foreach (self::CONTRACTS as $uri => $snapshot) {
            $expected = $this->loadSnapshot($snapshot);
            if ($expected === null) {
                $this->fail("Chýba referenčný tvar tests/snapshots/{$snapshot}.shape.json");
            }

            $response = $this->getJson($uri);
            $response->assertOk();

            $live = $this->shape($response->json());

            $missing = array_values(array_diff(
                $this->flatten($expected),
                $this->flatten($live),
            ));

            if ($missing !== []) {
                $missingByEndpoint[$uri] = $missing;
            }
        }

        $this->assertSame([], $missingByEndpoint, $this->describeMissing($missingByEndpoint));
    }

    private function describeMissing(array $missingByEndpoint): string
    {
        if ($missingByEndpoint === []) {
            return '';
        }

        $lines = ['Z kontraktu zmizli kľúče (odobranie/premenovanie je breaking change):'];
        foreach ($missingByEndpoint as $uri => $paths) {
            $lines[] = "  {$uri}";
            foreach ($paths as $p) {
                $lines[] = "    - {$p}";
            }
        }

        return implode("\n", $lines);
    }

    private function loadSnapshot(string $name): ?array
    {
        $path = base_path("tests/snapshots/{$name}.shape.json");
        if (! is_file($path)) {
            return null;
        }

        return json_decode((string) file_get_contents($path), true);
    }

    /**
     * Objekty, ktorých KĽÚČE sú dáta, nie kontrakt — zbalia sa na "*".
     * Musí zostať totožné s DICT_PATHS v tests/snapshots/derive-shapes.mjs.
     *
     * `by_area` má ako kľúče ID oblastí, `projects` názvy projektov. Zámerne NIE
     * heuristika „všetky hodnoty rovnakého tvaru" — tá by zbalila aj pevné slovníky
     * `by_type` (core/memory/project/skill) a `counts`, ktoré kontraktom SÚ.
     *
     * `months` (v `heatmap`) pribudlo neskôr: jeho kľúče sú POZIČNÉ OFFSETY stĺpcov
     * heatmapy a hodnoty názvy mesiacov — dnes `{"0":"aug","5":"sep",…}`, v pôvodnom
     * snapshote `{"1":…,"6":…}`. Posúvajú sa s dátumovým rozsahom, takže test hlásil
     * „zmizol kontraktný kľúč heatmap.months.49", hoci sa nezmenil tvar, len dátum.
     * Kontraktom je tu tvar hodnoty, nie čísla kľúčov.
     */
    private const DICT_PATHS = ['by_area', 'projects', 'months'];

    /** Rovnaká logika ako tests/snapshots/derive-shapes.mjs, prenesená do PHP. */
    private function shape(mixed $value, string $path = ''): mixed
    {
        if ($value === null) {
            return 'null';
        }

        if (is_array($value) && array_is_list($value)) {
            if ($value === []) {
                return ['empty'];
            }

            $merged = [];        // zlúčené kľúče objektových prvkov
            $nested = null;      // prvky, ktoré sú samé polia (pole polí)
            $scalars = [];       // skalárne typy prvkov
            foreach ($value as $item) {
                $s = $this->shape($item, $path.'[]');
                if (is_array($s) && ! array_is_list($s)) {
                    foreach ($s as $k => $v) {
                        $merged[$k] = array_key_exists($k, $merged) ? $this->unionType($merged[$k], $v) : $v;
                    }
                } elseif (is_array($s)) {
                    $nested = $nested === null ? $s : $this->unionType($nested, $s);
                } else {
                    $scalars[(string) $s] = true;
                }
            }

            if ($merged !== []) {
                ksort($merged);

                return [$merged];
            }

            if ($nested !== null) {
                return [$nested];
            }

            $types = array_keys($scalars);
            sort($types);

            return [implode('|', $types) ?: 'empty'];
        }

        if (is_array($value)) {
            $leaf = ($pos = strrpos($path, '.')) === false ? $path : substr($path, $pos + 1);
            if (in_array($leaf, self::DICT_PATHS, true)) {
                // slovník s dátovými kľúčmi — zachová sa len tvar hodnoty pod "*"
                if ($value === []) {
                    return ['*' => 'empty'];
                }
                $mergedValue = null;
                foreach ($value as $v) {
                    $s = $this->shape($v, $path.'.*');
                    $mergedValue = $mergedValue === null ? $s : $this->unionType($mergedValue, $s);
                }

                return ['*' => $mergedValue];
            }

            $out = [];
            foreach ($value as $k => $v) {
                $out[$k] = $this->shape($v, $path === '' ? (string) $k : $path.'.'.$k);
            }
            ksort($out);

            return $out;
        }

        return match (true) {
            is_bool($value) => 'boolean',
            is_int($value), is_float($value) => 'number',
            default => 'string',
        };
    }

    private function unionType(mixed $a, mixed $b): mixed
    {
        if (json_encode($a) === json_encode($b)) {
            return $a;
        }

        if (is_string($a) && is_string($b)) {
            $parts = array_unique(array_merge(explode('|', $a), explode('|', $b)));
            sort($parts);

            return implode('|', $parts);
        }

        if (is_array($a) && is_array($b) && ! array_is_list($a) && ! array_is_list($b)) {
            $out = $a;
            foreach ($b as $k => $v) {
                $out[$k] = array_key_exists($k, $out) ? $this->unionType($out[$k], $v) : $v;
            }
            ksort($out);

            return $out;
        }

        if ($a === 'null') {
            return $b;
        }
        if ($b === 'null') {
            return $a;
        }

        return json_encode($a) < json_encode($b) ? $a : $b;
    }

    /**
     * Tvar → zoznam ciest kľúčov ("nodes[].certainty"). Typ sa zámerne IGNORUJE:
     * null|string vs string je legitímna zmena dát, kým strata kľúča nie je.
     *
     * @return list<string>
     */
    private function flatten(mixed $shape, string $prefix = ''): array
    {
        $out = [];

        if (is_array($shape) && array_is_list($shape)) {
            foreach ($shape as $item) {
                if (is_array($item)) {
                    $out = array_merge($out, $this->flatten($item, $prefix.'[]'));
                }
            }

            return array_values(array_unique($out));
        }

        if (is_array($shape)) {
            foreach ($shape as $k => $v) {
                $path = $prefix === '' ? (string) $k : $prefix.'.'.$k;
                $out[] = $path;
                $out = array_merge($out, $this->flatten($v, $path));
            }
        }

        return array_values(array_unique($out));
    }
}
