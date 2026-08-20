<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Decision;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Náprava zápisu — mazanie rozhodnutí a uložených smerníc (audit 20. 8. 2026).
 *
 * Obe plochy vedeli dovtedy len rásť. `Api\DecisionController` mal `index` a
 * `store`, takže zle zapísané rozhodnutie sa dalo „opraviť" jedine tým, že sa
 * vedľa neho zapíše ďalšie — na obrazovke, ktorej účel je držať pamäť v poriadku.
 * `DirectiveController` mal `save` bez protikusu, takže každá preformulovaná
 * úloha nechala v `directives/` ďalší .md a zoznam sa upratoval len ručne v repo.
 *
 * Test stráži tri veci:
 *
 *  1. **Mazanie naozaj maže** — riadok zmizne z DB aj z časovej osi, súbor
 *     smernice zmizne z disku aj zo zoznamu.
 *  2. **Neexistujúce id / názov je 404, nie 500 ani ticho.**
 *  3. **Cesta smernice sa odmieta, nesanitizuje** — traversal nesmie siahnuť za
 *     `hades.directives_path`. Sanitizovaná cesta by ticho zmazala iný súbor,
 *     čo je horšie než chyba (to isté pravidlo ako `Tools\PathGuard` v Charónovi).
 *
 * Markdown zrkadlo rozhodnutia (`source_file`) sa **zámerne nemaže** — vyrezať
 * riadok zo súboru v mozgu je nevratný zásah do zdroja, nie do indexu. Odpoveď
 * cestu vracia, aby o nej UI vedelo povedať pravdu; testuje sa to nižšie.
 */
class DecisionDirectiveDeleteTest extends TestCase
{
    use RefreshDatabase;

    private string $tmp;

    private int $areaId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tmp = sys_get_temp_dir().'/hades-directives-'.bin2hex(random_bytes(4));
        mkdir($this->tmp, 0775, true);

        config([
            'hades.directives_path' => $this->tmp,
            'hades.allow_brain_write' => false,
            'cache.default' => 'array',
        ]);

        $this->areaId = Area::create([
            'name' => 'Vývoj / kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0,
        ])->id;
    }

    protected function tearDown(): void
    {
        foreach (glob($this->tmp.'/*') ?: [] as $file) {
            @unlink($file);
        }
        @rmdir($this->tmp);

        parent::tearDown();
    }

    // ---- rozhodnutia --------------------------------------------------------

    public function test_deleting_a_decision_removes_it_from_the_database_and_the_timeline(): void
    {
        $decision = $this->decision(['text' => 'Toto rozhodnutie bolo zapísané zle.']);
        $keep = $this->decision(['text' => 'Toto zostáva.']);

        $this->deleteJson('/api/decisions/'.$decision->id)
            ->assertOk()
            ->assertJson(['deleted' => $decision->id]);

        $this->assertDatabaseMissing('decisions', ['id' => $decision->id]);

        $ids = collect($this->getJson('/api/decisions')->assertOk()->json('decisions'))
            ->pluck('id')->all();

        $this->assertNotContains($decision->id, $ids, 'Zmazané rozhodnutie ostalo na časovej osi.');
        $this->assertContains($keep->id, $ids, 'Mazanie zobralo aj rozhodnutie, o ktoré nikto nežiadal.');
    }

    public function test_deleting_a_decision_that_does_not_exist_returns_404(): void
    {
        $this->deleteJson('/api/decisions/999999')->assertNotFound();
    }

    /**
     * Zrkadlo v mozgu sa nemaže a odpoveď to musí priznať — UI z toho skladá
     * vetu „zápis v … zostáva". Bez `source_file` v odpovedi by sa človek o
     * zvyšku dozvedel až pri ďalšom čítaní súboru.
     */
    public function test_deleting_a_decision_reports_the_markdown_mirror_it_leaves_behind(): void
    {
        $decision = $this->decision([
            'text' => 'Rozhodnutie so zrkadlom.',
            'origin' => 'brain',
            'source_file' => 'brain/rozhodnutia/2026-08.md',
        ]);

        $this->deleteJson('/api/decisions/'.$decision->id)
            ->assertOk()
            ->assertJson([
                'deleted' => $decision->id,
                'source_file' => 'brain/rozhodnutia/2026-08.md',
            ]);
    }

    /**
     * Obrazovka posiela filtre na server (`decisionsQuery()` v `rozhodnutia.js`)
     * a nepreosieva si ich sama — nad stropom 500 riadkov by preosievanie
     * hľadalo v prvej stránke a tvárilo sa, že hľadalo vo všetkom.
     */
    public function test_the_timeline_filters_by_query_and_area_on_the_server(): void
    {
        $other = Area::create([
            'name' => 'Osobné', 'slug' => 'osobne', 'color' => '#7e5a03', 'angle' => 90,
        ])->id;

        $hit = $this->decision(['text' => 'Prešli sme na ngrok tunel.']);
        $byReason = $this->decision(['text' => 'Bez zhody v texte.', 'reason' => 'Kvôli ngrok doméne.']);
        $miss = $this->decision(['text' => 'Nič spoločné.', 'area_id' => $other]);

        $found = collect($this->getJson('/api/decisions?q=ngrok')->assertOk()->json('decisions'))
            ->pluck('id')->all();

        $this->assertContains($hit->id, $found);
        $this->assertContains($byReason->id, $found, 'Hľadanie musí siahnuť aj do dôvodu.');
        $this->assertNotContains($miss->id, $found);

        $inArea = collect($this->getJson('/api/decisions?area='.$other)->assertOk()->json('decisions'))
            ->pluck('id')->all();

        $this->assertSame([$miss->id], $inArea, 'Filter oblasti na serveri nevrátil práve jej rozhodnutia.');
    }

    // ---- smernice -----------------------------------------------------------

    public function test_deleting_a_saved_directive_removes_the_file_and_the_listing(): void
    {
        $this->postJson('/api/directive/save', [
            'name' => 'Nasadenie na ngrok',
            'markdown' => "# Smernica\n\nObsah.",
        ])->assertOk();

        $path = $this->tmp.'/nasadenie-na-ngrok.md';
        $this->assertFileExists($path);

        $this->deleteJson('/api/directive/nasadenie-na-ngrok')
            ->assertOk()
            ->assertJson(['deleted' => 'nasadenie-na-ngrok']);

        $this->assertFileDoesNotExist($path);

        $names = collect($this->getJson('/api/directives')->assertOk()->json('directives'))
            ->pluck('name')->all();

        $this->assertNotContains('nasadenie-na-ngrok', $names, 'Zmazaná smernica ostala v zozname.');
    }

    public function test_deleting_a_directive_that_does_not_exist_returns_404(): void
    {
        $this->deleteJson('/api/directive/toto-neexistuje')->assertNotFound();
    }

    /**
     * Traversal končí ako neexistujúci slug (404), nie ako zmazaný cudzí súbor.
     */
    public function test_deleting_a_directive_cannot_reach_outside_the_directives_folder(): void
    {
        $outside = dirname($this->tmp).'/hades-mimo-'.bin2hex(random_bytes(4)).'.md';
        file_put_contents($outside, 'nedotknuteľné');

        try {
            $this->deleteJson('/api/directive/'.urlencode('../'.basename($outside, '.md')))
                ->assertNotFound();

            $this->assertFileExists($outside, 'Mazanie smernice siahlo mimo priečinka smerníc.');
        } finally {
            @unlink($outside);
        }
    }

    // ---- pomocné ------------------------------------------------------------

    private function decision(array $attrs = []): Decision
    {
        return Decision::create(array_merge([
            'area_id' => $this->areaId,
            'decided_on' => '2026-08-19',
            'text' => 'Rozhodnutie.',
            'origin' => 'session',
        ], $attrs));
    }
}
