<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Node;
use App\Models\Tag;
use App\Serializers\Screen\KniznicaScreen;
use App\Serializers\Screen\SmernicaScreen;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Dvojitá plocha pre Smernicu a Knižnicu (vlna E).
 *
 * Smernica bola z celej appky najhorší rozchod plôch: server posielal hotový
 * `markdown`, prehliadač ho zahodil a poskladal si vlastný podľa
 * `DirectiveController::buildMarkdown()`. Namerané pred zmenou na troch reálnych
 * úlohách: 15–23 z ~45 riadkov sa líšilo (PHP `Str::limit` kráti na `...`, JS
 * krátil na `…`), takže prompt, ktorý si človek skopíroval do Claude Code, NEBOL
 * ten, ktorý by dostala AI. Prvý test tohto súboru je brána proti tomu, aby sa
 * druhá implementácia vrátila.
 *
 * PHP test nevie spustiť prehliadač, takže „znak za znak ten istý" sa dokazuje
 * dvoma vrstvami naraz:
 *
 *  1. **Hodnotovo** — markdown pre plný výber (`include_ids` = všetko, čo
 *     obrazovka po poskladaní zaškrtne) musí byť identický s markdownom, ktorý
 *     `/build` posiela bez výberu. To je presne tá cesta, po ktorej ide náhľad.
 *  2. **Štrukturálne** — v `smernica.js` nesmie zostať skladanie markdownu.
 *     Bez tejto vrstvy by test prešel aj vtedy, keby si UI ďalej skladalo svoje;
 *     hodnoty by sedeli a rozchod by žil vedľa nich, presne ako doteraz.
 *
 * Knižnica má menší, ale rovnaký druh diery: počty a strop značiek si počítal
 * prehliadač, a AI z tej istej odpovede čítala iné číslo než človek.
 */
class ScreenSmernicaKniznicaTest extends TestCase
{
    use RefreshDatabase;

    /** Skutočný súbor v repo — bez neho nie je skill `verified` a sekcia chýba. */
    private const REAL_SKILL_KEY = 'skill:it/api-security';

    private Area $area;

    protected function setUp(): void
    {
        parent::setUp();

        // Návrh sa medzi dvoma volaniami /build drží v cache (SmernicaScreen);
        // test ju chce mať vlastnú, nie zdieľanú s bežiacou appkou.
        config(['cache.default' => 'array']);

        $this->area = Area::create([
            'name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0,
        ]);
    }

    private function node(string $label, array $attrs = []): Node
    {
        return Node::create(array_merge([
            'type' => 'skill',
            'label' => $label,
            'description' => 'Popis uzla, dosť dlhý na to, aby nebol stub.',
            'area_id' => $this->area->id,
            'strength' => 1,
        ], $attrs));
    }

    /**
     * Návrh z ručne vybraných uzlov. Ide zámerne cez `node_ids` a nie cez `task`:
     * `searchNodes` stojí na MariaDB COLLATE a na sqlite by sa celý tento súbor
     * preskočil — teda práve tam, kde sada beží vždy, by brána nebola.
     *
     * @param  list<int>  $ids
     * @return array<string, mixed>
     */
    private function build(array $ids, ?array $include = null): array
    {
        $body = ['node_ids' => $ids];
        if ($include !== null) {
            $body['include_ids'] = $include;
        }

        return $this->postJson('/api/directive/build', $body)->assertOk()->json();
    }

    /** Uzly do všetkých piatich sekcií návrhu. @return list<int> */
    private function seedDirectiveNodes(): array
    {
        $core = Area::create([
            'name' => 'Osobné & preferencie', 'slug' => 'osobne-preferencie', 'color' => '#b3803a', 'angle' => 1,
        ]);

        return [
            $this->node('API security', ['external_key' => self::REAL_SKILL_KEY])->id,
            $this->node('Reverb bez .md', ['description' => 'Broadcast cez Laravel Reverb v Dockeri, dlhý popis.'])->id,
            $this->node('Pasca portu', ['certainty' => 'pasca', 'description' => 'Reverb v Dockeri musí mať host 0.0.0.0.'])->id,
            $this->node('Hades', ['type' => 'project', 'meta' => ['cwd' => 'C:\\Users\\Ucet\\Desktop\\AI-mind']])->id,
            $this->node('Docker VM má 22,9 GiB', ['type' => 'memory'])->id,
            $this->node('Kód anglicky, UI slovensky', ['area_id' => $core->id, 'type' => 'memory'])->id,
        ];
    }

    // ---- 1. payload sa nesmie rozbiť ---------------------------------------

    public function test_the_directive_endpoints_keep_every_key_they_had(): void
    {
        $data = $this->build($this->seedDirectiveNodes());

        foreach (['task', 'suggested', 'markdown'] as $key) {
            $this->assertArrayHasKey($key, $data, "/api/directive/build stratil kľúč `{$key}`.");
        }
        foreach (SmernicaScreen::SECTIONS as $section) {
            $this->assertArrayHasKey($section, $data['suggested']);
        }
        $this->assertArrayHasKey('verified', $data['suggested']['skills'][0]);

        $this->assertArrayHasKey('templates', $this->getJson('/api/directive/templates')->assertOk()->json());
        $this->assertArrayHasKey('directives', $this->getJson('/api/directives')->assertOk()->json());
    }

    public function test_the_saved_directives_carry_the_time_they_were_sorted_by(): void
    {
        // Do 1. 9. 2026 si `saved()` prečítala `filemtime()`, zoradila ním a potom
        // ho z každého riadka `unset`-la. V odpovedi teda bolo PORADIE, ale nie
        // HODNOTA — obrazovka nemohla napísať „pred 2 dňami" ani zoradiť inak.
        $dir = sys_get_temp_dir().'/hades-saved-'.bin2hex(random_bytes(4));
        mkdir($dir, 0775, true);
        config(['hades.directives_path' => $dir]);

        $stamps = [
            'stara' => strtotime('2026-08-01 10:00:00'),
            'nova' => strtotime('2026-08-30 10:00:00'),
            'prostredna' => strtotime('2026-08-15 10:00:00'),
        ];

        try {
            foreach ($stamps as $name => $ts) {
                file_put_contents("{$dir}/{$name}.md", "# Smernica: {$name}

telo
");
                touch("{$dir}/{$name}.md", $ts);
            }

            $rows = $this->getJson('/api/directives')->assertOk()->json('directives');

            // 1. Poradie zostalo — najnovšie prvé. Toto platilo aj predtým.
            $this->assertSame(['nova', 'prostredna', 'stara'], array_column($rows, 'name'));

            // 2. A čas je v odpovedi, presne ten, ktorým sa radilo. Nie „teraz":
            //    keby sa dopĺňal aktuálny čas, boli by všetky tri rovnaké.
            foreach ($rows as $row) {
                $this->assertArrayHasKey('saved_at', $row, 'Zoznam smerníc stratil čas úpravy.');
                $this->assertSame(
                    $stamps[$row['name']],
                    strtotime((string) $row['saved_at']),
                    "`saved_at` smernice {$row['name']} nie je jej `filemtime`.",
                );
            }

            $this->assertCount(3, array_unique(array_column($rows, 'saved_at')));

            // 3. `mtime` je interný kľúč radenia a v odpovedi nesmie zostať —
            //    surové unixové číslo je pre klienta druhý tvar tej istej pravdy.
            $this->assertArrayNotHasKey('mtime', $rows[0]);
        } finally {
            foreach (glob($dir.'/*') ?: [] as $file) {
                @unlink($file);
            }
            @rmdir($dir);
        }
    }

    public function test_the_library_endpoint_keeps_every_key_it_had(): void
    {
        $this->node('Docker Compose', ['external_key' => 'skill:it/docker'])->tags()->attach(Tag::forName('devops'));

        $area = $this->getJson('/api/library')->assertOk()->json('areas.0');

        foreach (['name', 'color', 'skills'] as $key) {
            $this->assertArrayHasKey($key, $area, "/api/library stratil kľúč `{$key}`.");
        }
        foreach (['id', 'label', 'path', 'snippet', 'origin', 'certainty', 'tags'] as $key) {
            $this->assertArrayHasKey($key, $area['skills'][0], "/api/library stratil kľúč skills[].{$key}.");
        }
        $this->assertSame('skills/it/docker.md', $area['skills'][0]['path']);
        $this->assertSame(['devops'], $area['skills'][0]['tags']);
    }

    // ---- 2. markdown zo servera JE ten, ktorý UI zobrazí -------------------

    public function test_the_markdown_the_screen_shows_is_byte_for_byte_the_servers(): void
    {
        $ids = $this->seedDirectiveNodes();

        $full = $this->build($ids);
        // presne to, čo obrazovka pošle: zaškrtnuté je všetko, čo návrh obsahuje
        $shown = $this->build($ids, $full['selected_ids']);

        $this->assertSame(
            $full['markdown'],
            $shown['markdown'],
            'Markdown pre plný výber sa líši od toho, ktorý /build posiela sám — '.
            'náhľad na obrazovke by teda nebol ten, ktorý dostane AI.',
        );
        $this->assertSame($full['selected_ids'], $shown['selected_ids']);
        $this->assertNotSame('', trim($full['markdown']), 'Prázdny markdown by test zmenil na tautológiu.');
        $this->assertStringContainsString('## Použi tieto skilly', $full['markdown']);
    }

    /**
     * Živý kód obrazovky bez komentárov.
     *
     * Komentáre sa musia odstrániť, inak test meria vlastnú dokumentáciu: veta
     * „strop je na serveri, `slice(0, 5)` tu už nie je" obsahuje presne ten
     * vzor, ktorý hľadá, a brána by hlásila poruchu za to, že je popísaná.
     */
    private function codeOf(string $screen): string
    {
        $js = (string) file_get_contents(base_path('public/js/mind/screens/'.$screen.'.js'));
        $js = (string) preg_replace('#/\*.*?\*/#s', '', $js);

        return (string) preg_replace('#^\s*//.*$#m', '', $js);
    }

    public function test_the_browser_no_longer_assembles_the_markdown_itself(): void
    {
        $js = $this->codeOf('smernica');

        foreach (['buildDirectiveMarkdown', 'dirHowTo', 'dirInfoSuffix', 'dirOneLine'] as $gone) {
            $this->assertStringNotContainsString(
                'function '.$gone,
                $js,
                "`{$gone}` je späť v smernica.js — druhá implementácia markdownu sa vrátila.",
            );
        }

        // Nadpis sekcie v JS = obrazovka si skladá dokument. Server ich má sedem.
        $this->assertSame(
            0,
            preg_match_all("/'#+ /", $js),
            'V smernica.js sú markdown nadpisy — dokument sa skladá v prehliadači.',
        );

        // A pozitívne: výber sa posiela na server, nefiltruje sa lokálne.
        $this->assertStringContainsString('include_ids', $js);
    }

    public function test_unchecking_an_item_drops_it_from_the_server_markdown(): void
    {
        $ids = $this->seedDirectiveNodes();
        $full = $this->build($ids);

        $keep = array_slice($full['selected_ids'], 0, 2);
        $less = $this->build($ids, $keep);

        $this->assertLessThan(strlen($full['markdown']), strlen($less['markdown']));
        $this->assertSame($keep, $less['selected_ids']);
        $this->assertStringNotContainsString('Pasca portu', $less['markdown']);
        // návrh ostáva celý — odškrtnutá položka sa musí dať zaškrtnúť späť
        $this->assertSame($full['suggested'], $less['suggested']);
    }

    public function test_a_selection_can_never_smuggle_in_a_node_the_screen_did_not_show(): void
    {
        $ids = $this->seedDirectiveNodes();
        $hidden = $this->node('Uzol, ktorý v návrhu nie je')->id;

        $data = $this->build($ids, [$hidden]);

        $this->assertSame([], $data['selected_ids']);
        $this->assertStringNotContainsString('Uzol, ktorý v návrhu nie je', $data['markdown']);
    }

    public function test_the_counts_come_from_the_server_and_match_the_proposal(): void
    {
        $data = $this->build($this->seedDirectiveNodes());

        foreach (SmernicaScreen::SECTIONS as $section) {
            $this->assertSame(
                count($data['suggested'][$section]),
                $data['counts'][$section],
                "`counts.{$section}` nesedí s návrhom — obrazovka by hlásila iné číslo než mozog.",
            );
        }
        $this->assertSame(count($data['selected_ids']), $data['counts']['total']);
    }

    public function test_the_task_path_through_the_search_engine_agrees_with_itself(): void
    {
        if (DB::connection()->getDriverName() === 'sqlite') {
            $this->markTestSkipped('searchNodes vyžaduje MariaDB COLLATE.');
        }

        $this->node('Reverb websockety', ['description' => 'Broadcast cez Laravel Reverb v Dockeri.']);

        $full = $this->postJson('/api/directive/build', ['task' => 'reverb websockety'])->assertOk()->json();
        $shown = $this->postJson('/api/directive/build', [
            'task' => 'reverb websockety',
            'include_ids' => $full['selected_ids'],
        ])->assertOk()->json();

        $this->assertSame($full['markdown'], $shown['markdown']);
    }

    // ---- 3. Knižnica: skilly jednej oblasti + cesta k .md ------------------

    public function test_the_library_can_hand_over_one_areas_skills_with_their_md_paths(): void
    {
        $other = Area::create(['name' => 'Marketing', 'slug' => 'marketing', 'color' => '#b3803a', 'angle' => 2]);
        $this->node('API security', ['external_key' => self::REAL_SKILL_KEY]);
        $this->node('Docker Compose', ['external_key' => 'skill:it/docker']);
        $this->node('Newsletter', ['external_key' => 'skill:marketing/newsletter', 'area_id' => $other->id]);

        $ai = (new KniznicaScreen(['area' => 'vyvoj-kod']))->forAi();

        $this->assertCount(1, $ai['areas'], 'Zúženie na oblasť musí vrátiť práve tú jednu.');
        $this->assertSame('vyvoj-kod', $ai['areas'][0]['slug']);
        $this->assertSame(2, $ai['areas'][0]['count']);

        $paths = array_column($ai['areas'][0]['skills'], 'path');
        $this->assertContains('skills/it/api-security.md', $paths);
        $this->assertContains('skills/it/docker.md', $paths);

        // to isté aj cez názov oblasti — človek klikne na názov, AI pozná slug
        $this->assertCount(1, (new KniznicaScreen(['area' => 'Vývoj & kód']))->forAi()['areas']);
    }

    public function test_the_tag_cap_is_the_servers_so_both_planes_read_the_same_chips(): void
    {
        $node = $this->node('Docker Compose', ['external_key' => 'skill:it/docker']);
        foreach (['a', 'b', 'c', 'd', 'e', 'f', 'g'] as $name) {
            $node->tags()->attach(Tag::forName('tag-'.$name));
        }

        $skill = $this->getJson('/api/library')->assertOk()->json('areas.0.skills.0');

        $this->assertCount(KniznicaScreen::TAG_CAP, $skill['tags']);
        $this->assertSame(7 - KniznicaScreen::TAG_CAP, $skill['tags_more']);

        $js = $this->codeOf('kniznica');
        $this->assertStringNotContainsString('slice(0, 5)', $js, 'Strop značiek sa vrátil do prehliadača.');
        $this->assertStringNotContainsString('skills.length', $js, 'Počet skillov sa opäť dopočítava v prehliadači.');
    }

    // ---- 4. plocha pre AI je reálne úzka ----------------------------------

    public function test_the_library_for_the_ai_is_a_fraction_of_the_screen(): void
    {
        for ($i = 0; $i < 60; $i++) {
            $node = $this->node('Skill číslo '.$i, [
                'external_key' => 'skill:it/skill-'.$i,
                'description' => str_repeat('Dlhý popis playbooku, ktorý na obrazovke tvorí snippet. ', 6),
            ]);
            $node->tags()->attach(Tag::forName('tag-'.$i));
        }

        $human = strlen((string) json_encode((new KniznicaScreen(['limit' => null]))->data(), JSON_UNESCAPED_UNICODE));
        $ai = strlen((string) json_encode((new KniznicaScreen)->forAi(), JSON_UNESCAPED_UNICODE));

        $this->assertLessThan(
            $human * 0.35,
            $ai,
            "Plocha pre AI ({$ai} B) nie je výrazne užšia než plocha človeka ({$human} B) — ".
            'jedno volanie by zožralo kontext.',
        );

        // Kľúče pre oko nesmú byť v odpovedi pre AI ani na jednom riadku.
        $first = (new KniznicaScreen)->forAi()['areas'][0]['skills'][0];
        foreach (['snippet', 'origin', 'tags', 'tags_more'] as $forTheEye) {
            $this->assertArrayNotHasKey($forTheEye, $first);
        }
        $this->assertArrayNotHasKey('color', (new KniznicaScreen)->forAi()['areas'][0]);
    }

    public function test_the_directive_for_the_ai_carries_the_prompt_and_not_its_raw_material(): void
    {
        $ids = $this->seedDirectiveNodes();
        $screen = new SmernicaScreen(['node_ids' => $ids]);

        $ai = $screen->forAi();

        $this->assertSame($screen->data()['markdown'], $ai['markdown'], 'AI musí dostať ten istý text.');
        foreach (['suggested', 'templates', 'directives', 'selected_ids'] as $forTheEye) {
            $this->assertArrayNotHasKey($forTheEye, $ai);
        }
        $this->assertLessThan(
            strlen((string) json_encode($screen->data())) * 0.6,
            strlen((string) json_encode($ai)),
            'Smernica pre AI nesie surovinu aj hotový prompt — každý uzol je zaplatený dvakrát.',
        );
    }

    // ---- 5. kontrakt výberu ------------------------------------------------

    public function test_the_ai_field_lists_never_name_a_key_the_screen_does_not_have(): void
    {
        $this->node('Docker Compose', ['external_key' => 'skill:it/docker']);
        $ids = $this->seedDirectiveNodes();

        $screens = [
            'smernica' => new SmernicaScreen(['node_ids' => $ids]),
            'kniznica' => new KniznicaScreen,
        ];

        foreach ($screens as $name => $screen) {
            $data = $screen->data();

            foreach ($screen->fieldsForAi() as $field) {
                [$root] = explode('[].', $field, 2);

                $this->assertArrayHasKey(
                    $root,
                    $data,
                    "Obrazovka {$name} menuje pre AI kľúč `{$field}`, ktorý `data()` nedáva. ".
                    'Preklep v zozname by pole ticho vyhodil z odpovede pre AI.',
                );
            }

            $this->assertNotSame([], $screen->fieldsForAi(), "Obrazovka {$name} nedeklaruje plochu pre AI.");
        }
    }

    public function test_every_shared_key_of_the_screen_and_the_ai_plane_is_identical(): void
    {
        $this->node('Docker Compose', ['external_key' => 'skill:it/docker']);
        $ids = $this->seedDirectiveNodes();

        // Rovnaké parametre na oboch plochách — inak by test porovnával dva dopyty.
        $this->assertParity(
            (new SmernicaScreen(['node_ids' => $ids]))->data(),
            (new SmernicaScreen(['node_ids' => $ids]))->forAi(),
            'mind_directive',
        );
        $this->assertParity(
            (new KniznicaScreen(['area' => 'vyvoj-kod']))->data(),
            (new KniznicaScreen(['area' => 'vyvoj-kod']))->forAi(),
            'mind_library',
        );
    }

    /**
     * Každý kľúč, ktorý AI dostala, musí mať v ploche človeka identickú hodnotu.
     * Opačný smer sa nekontroluje zámerne — plocha človeka smie mať navyše.
     *
     * @param  array<string, mixed>  $human
     * @param  array<string, mixed>  $ai
     */
    private function assertParity(array $human, array $ai, string $tool, string $path = ''): void
    {
        foreach ($ai as $key => $value) {
            $here = $path === '' ? (string) $key : "{$path}.{$key}";

            $this->assertArrayHasKey(
                $key,
                $human,
                "{$tool} vracia `{$here}`, ktoré obrazovka nemá — to je druhá implementácia.",
            );

            if (is_array($value) && is_array($human[$key])) {
                $this->assertParity($human[$key], $value, $tool, $here);

                continue;
            }

            $this->assertSame($human[$key], $value, "{$tool} a obrazovka sa rozišli na `{$here}`.");
        }
    }
}
