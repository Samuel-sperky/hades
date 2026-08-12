<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Department;
use App\Models\Node;
use App\Models\Tombstone;
use App\Services\MindService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * A2–A4 — identita uzla (uuid + slug), soft delete a nástroje mind_rename /
 * mind_move / mind_delete.
 *
 * Doteraz sa uzly dali len pridávať a zlučovať, takže odpad (surové prompty,
 * markdownové labely, prázdne stuby, dvanásť oddelení pomenovaných po docker
 * worktree priečinkoch) sa nedal odstrániť ani opraviť — len prekryť ďalším
 * uzlom.
 */
class NodeCurationTest extends TestCase
{
    use RefreshDatabase;

    private const TOKEN = 'test-mcp-token';

    private MindService $mind;

    private Area $vyvoj;

    private Area $biznis;

    protected function setUp(): void
    {
        parent::setUp();

        config(['hades.mcp_token' => self::TOKEN, 'cache.default' => 'array']);

        $this->mind = app(MindService::class);

        $this->vyvoj = Area::create(['name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0]);
        $this->biznis = Area::create(['name' => 'Biznis & projekty', 'slug' => 'biznis-projekty', 'color' => '#d8b878', 'angle' => 90]);

        Department::create(['area_id' => $this->vyvoj->id, 'name' => 'Backend', 'slug' => 'backend']);
        Department::create(['area_id' => $this->biznis->id, 'name' => 'Aplikácie', 'slug' => 'aplikacie']);
    }

    private function callTool(string $tool, array $args = []): TestResponse
    {
        return $this->withHeader('Authorization', 'Bearer '.self::TOKEN)
            ->postJson('/mcp', [
                'jsonrpc' => '2.0',
                'id' => 1,
                'method' => 'tools/call',
                'params' => ['name' => $tool, 'arguments' => $args],
            ]);
    }

    private function payload(TestResponse $res): array
    {
        return json_decode($res->json('result.content.0.text'), true);
    }

    private function node(string $label, array $attrs = []): Node
    {
        return Node::create(array_merge([
            'type' => 'memory',
            'label' => $label,
            'area_id' => $this->vyvoj->id,
            'strength' => 1,
        ], $attrs));
    }

    // ---- A2: identita ----

    public function test_new_node_gets_uuid_and_slug_automatically(): void
    {
        $node = $this->node('Zľavy ovládač');

        $this->assertNotNull($node->uuid);
        $this->assertSame('zlavy-ovladac', $node->slug, 'slug musí byť bez diakritiky a lowercase');
    }

    public function test_slug_follows_the_label_on_rename(): void
    {
        $node = $this->node('Pôvodný názov');

        $this->mind->rename($node, 'Nový názov');

        $this->assertSame('novy-nazov', $node->fresh()->slug);
    }

    public function test_slug_reveals_a_duplicate_written_without_diacritics(): void
    {
        // presne ten anti-vzorec z auditu: ten istý uzol raz s diakritikou, raz bez
        $a = $this->node('Zľavy ovládač');
        $b = $this->node('Zlavy ovladac');

        $this->assertSame($a->slug, $b->slug, 'kolízia slugov je signál duplicity, preto slug NIE JE unique');
    }

    public function test_find_exact_matches_by_label_and_by_slug(): void
    {
        $node = $this->node('Docker Compose');

        $this->assertSame($node->id, $this->mind->findExact('docker compose')?->id);
        $this->assertSame($node->id, $this->mind->findExact('Docker-Compose')?->id);
    }

    public function test_find_exact_refuses_an_ambiguous_label(): void
    {
        $this->node('Zľavy ovládač');
        $this->node('Zlavy ovladac');

        $this->assertNull(
            $this->mind->findExact('Zľavy ovládač'),
            'pri dvoch kandidátoch nesmie vrátiť ani jeden — mazať „skoro ten správny" uzol je horšie než odmietnuť'
        );
    }

    // ---- A4: rename ----

    public function test_rename_fixes_a_markdown_mangled_label(): void
    {
        $this->node('# Smernica: produkt foto automatizacia cez agentov v chatgpt');

        $res = $this->callTool('mind_rename', [
            'label' => '# Smernica: produkt foto automatizacia cez agentov v chatgpt',
            'new_label' => 'Smernica: automatizácia produktových fotiek',
        ]);

        $data = $this->payload($res->assertOk());
        $this->assertSame('renamed', $data['action']);
        $this->assertSame('Smernica: automatizácia produktových fotiek', $data['node']['label']);
    }

    public function test_rename_rejects_an_empty_new_label(): void
    {
        $this->node('Nejaký uzol');

        $res = $this->callTool('mind_rename', ['label' => 'Nejaký uzol', 'new_label' => '   ']);

        $this->assertTrue($res->json('result.isError'));
    }

    // ---- A4: move ----

    public function test_move_relocates_the_node(): void
    {
        $node = $this->node('Aura KPI appka', ['type' => 'project']);

        $res = $this->callTool('mind_move', [
            'label' => 'Aura KPI appka',
            'area' => 'Biznis & projekty',
            'department' => 'Aplikácie',
        ]);

        $data = $this->payload($res->assertOk());
        $this->assertSame('moved', $data['action']);
        $this->assertSame($this->biznis->id, $node->fresh()->area_id);
    }

    public function test_move_rejects_an_unknown_area_instead_of_silently_falling_back(): void
    {
        $node = $this->node('React');

        $res = $this->callTool('mind_move', ['label' => 'React', 'area' => 'Neexistujúca oblasť']);

        $this->assertTrue($res->json('result.isError'));
        $this->assertSame($this->vyvoj->id, $node->fresh()->area_id, 'uzol nesmie skončiť inde');
    }

    public function test_move_rejects_a_department_from_another_area(): void
    {
        $this->node('React');

        // 'Aplikácie' patrí do Biznisu, nie do Vývoja
        $res = $this->callTool('mind_move', [
            'label' => 'React',
            'area' => 'Vývoj & kód',
            'department' => 'Aplikácie',
        ]);

        $this->assertTrue($res->json('result.isError'));
    }

    // ---- A3 + A4: soft delete ----

    public function test_delete_hides_the_node_but_keeps_it_restorable(): void
    {
        $node = $this->node('ukladaj mi otazky tu v chate');

        $res = $this->callTool('mind_delete', ['label' => 'ukladaj mi otazky tu v chate', 'reason' => 'raw-prompt']);

        $data = $this->payload($res->assertOk());
        $this->assertSame('deleted', $data['action']);
        $this->assertTrue($data['reversible']);

        $this->assertNull(Node::find($node->id), 'zmazaný uzol nesmie byť v bežnom dopyte');
        $this->assertNotNull(Node::withTrashed()->find($node->id), 'ale fyzicky ostáva');
    }

    public function test_delete_releases_the_unique_external_key_and_leaves_a_tombstone(): void
    {
        $node = $this->node('Session záznam', ['external_key' => 'session:abc123']);

        $this->mind->softDelete($node, 'stub');

        $trashed = Node::withTrashed()->find($node->id);

        $this->assertNull($trashed->external_key, 'external_key je unique — soft-zmazaný uzol ho nesmie držať');
        $this->assertSame('session:abc123', $trashed->meta['released_external_key']);
        $this->assertTrue(
            Tombstone::where('external_key', 'session:abc123')->exists(),
            'bez náhrobku by najbližší ingest ten uzol vrátil'
        );

        // ten istý zdroj sa dá znovu zapísať bez pádu na unique constrainte
        $this->node('Znovu vytvorený', ['external_key' => 'session:abc123']);
        $this->assertSame(1, Node::where('external_key', 'session:abc123')->count());
    }

    public function test_restore_brings_back_the_node_its_key_and_removes_the_tombstone(): void
    {
        $node = $this->node('Omylom zmazaný', ['external_key' => 'session:xyz']);
        $this->mind->softDelete($node);

        $this->mind->restoreNode(Node::withTrashed()->find($node->id));

        $restored = Node::find($node->id);
        $this->assertNotNull($restored);
        $this->assertSame('session:xyz', $restored->external_key);
        $this->assertArrayNotHasKey('released_external_key', $restored->meta ?? []);
        $this->assertFalse(Tombstone::where('external_key', 'session:xyz')->exists());
    }

    public function test_deleted_node_disappears_from_recall(): void
    {
        // rovnaký dôvod ako pri recall teste v McpToolsTest: searchNodes() používa
        // COLLATE utf8mb4_unicode_ci, ktorý SQLite nepozná. Overené proti živej
        // MariaDB pri nasadení A3.
        if (config('database.default') === 'sqlite') {
            $this->markTestSkipped('recall/searchNodes vyžaduje MariaDB (COLLATE utf8mb4_unicode_ci)');
        }

        $node = $this->node('Kanárik na zmazanie', ['description' => 'kanarik testovaci uzol']);

        $this->assertTrue($this->mind->recall('kanárik')->contains('id', $node->id));

        $this->mind->softDelete($node);

        $this->assertFalse($this->mind->recall('kanárik')->contains('id', $node->id));
    }

    public function test_delete_refuses_an_unknown_label(): void
    {
        $res = $this->callTool('mind_delete', ['label' => 'Tento uzol neexistuje']);

        $this->assertTrue($res->json('result.isError'));
    }

    public function test_new_tools_are_advertised(): void
    {
        $res = $this->withHeader('Authorization', 'Bearer '.self::TOKEN)
            ->postJson('/mcp', ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'tools/list']);

        $names = collect($res->assertOk()->json('result.tools'))->pluck('name');

        $this->assertTrue($names->contains('mind_rename'));
        $this->assertTrue($names->contains('mind_move'));
        $this->assertTrue($names->contains('mind_delete'));
    }
}
