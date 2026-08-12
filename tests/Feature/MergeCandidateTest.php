<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\MergeCandidate;
use App\Models\Node;
use App\Services\MindService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A5 + A6 — prahy zlučovania a fronta návrhov.
 *
 * Pôvodná podmienka bola `similar_text >= 85 % ALEBO pomer dĺžok >= 0,6`, takže
 * samotný pomer dĺžok stačil na nevratné zlúčenie. Automerge navyše zlučoval sám
 * v noci — 26.7.2026 tak pohltil „Súhrn týždňa 30/2026" do „Súhrn týždňa 29/2026"
 * pri skóre 0,9258.
 */
class MergeCandidateTest extends TestCase
{
    use RefreshDatabase;

    private MindService $mind;

    protected function setUp(): void
    {
        parent::setUp();

        config(['cache.default' => 'array']);

        $this->mind = app(MindService::class);

        Area::create(['name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0]);
    }

    private function learn(string $type, string $label, ?string $description = null): array
    {
        return $this->mind->learn($type, $label, $description, 'Vývoj & kód');
    }

    // ---- A5: prahy ----

    public function test_identical_label_still_merges(): void
    {
        $this->learn('skill', 'Docker Compose');
        $result = $this->learn('skill', 'docker compose');

        $this->assertSame('merged', $result['action']);
        $this->assertSame(1, Node::where('type', 'skill')->count());
    }

    public function test_same_label_written_without_diacritics_merges_via_slug(): void
    {
        $this->learn('project', 'Zľavy ovládač');
        $result = $this->learn('project', 'Zlavy ovladac');

        $this->assertSame('merged', $result['action'], 'slug zhoda musí zlúčiť — je to ten istý uzol inak zapísaný');
        $this->assertSame(1, Node::where('type', 'project')->count());
    }

    public function test_length_ratio_alone_no_longer_merges(): void
    {
        // presne ten prípad, pred ktorým varuje komentár v pôvodnom kóde
        $this->learn('skill', 'Canvas visualization');
        $result = $this->learn('skill', 'Canva');

        $this->assertSame('created', $result['action'], 'krátky odlišný pojem sa nesmie zliať s dlhším');
        $this->assertSame(2, Node::where('type', 'skill')->count());
    }

    public function test_two_different_weeks_are_not_merged(): void
    {
        // reálny prípad z 26.7.2026, keď ich automerge nevratne zlúčil
        $this->learn('memory', 'Súhrn týždňa 29/2026');
        $result = $this->learn('memory', 'Súhrn týždňa 30/2026');

        $this->assertSame('created', $result['action']);
        $this->assertSame(2, Node::where('type', 'memory')->count());
    }

    // ---- A6: fronta návrhov ----

    public function test_same_label_with_a_different_type_is_queued_not_merged(): void
    {
        // 9 z 10 duplicít nájdených pri backfille slugov vyzeralo presne takto
        $this->learn('skill', 'Tracking page UX');
        $result = $this->learn('memory', 'Tracking page UX');

        $this->assertSame('created', $result['action'], 'cross-type sa nezlučuje — nevedno, či je to skill alebo memory');
        $this->assertSame(1, $result['duplicate_candidates']);

        $candidate = MergeCandidate::firstOrFail();
        $this->assertSame('cross_type_slug', $candidate->reason);
        $this->assertSame(MergeCandidate::STATUS_PENDING, $candidate->status);
    }

    public function test_a_similar_label_lands_in_review_instead_of_merging(): void
    {
        $this->learn('skill', 'Opportunity-Solution Tree');
        $result = $this->learn('skill', 'Opportunity Solution Trees');

        $this->assertSame('created', $result['action']);
        $this->assertSame('similar_label', MergeCandidate::firstOrFail()->reason);
    }

    public function test_a_candidate_pair_is_stored_only_once(): void
    {
        $a = Node::create(['type' => 'skill', 'label' => 'Alfa', 'strength' => 1]);
        $b = Node::create(['type' => 'memory', 'label' => 'Beta', 'strength' => 1]);

        $this->mind->recordMergeCandidate($a, $b, 90, 'cosine');
        $this->mind->recordMergeCandidate($b, $a, 90, 'cosine'); // opačné poradie

        $this->assertSame(1, MergeCandidate::count(), 'pár sa normalizuje na (menšie id, väčšie id)');
    }

    public function test_a_rejected_candidate_does_not_come_back(): void
    {
        $this->learn('skill', 'Tracking page UX');
        $this->learn('memory', 'Tracking page UX');

        MergeCandidate::firstOrFail()->update([
            'status' => MergeCandidate::STATUS_REJECTED,
            'resolved_at' => now(),
        ]);

        // ďalší zápis toho istého nesmie návrh znovu otvoriť
        $this->learn('memory', 'Tracking page UX', 'ďalší detail');

        $this->assertSame(0, MergeCandidate::pending()->count());
        $this->assertSame(1, MergeCandidate::count());
    }

    public function test_automerge_only_proposes_and_never_merges(): void
    {
        Node::create(['type' => 'skill', 'label' => 'Kubernetes deploy', 'description' => 'nasadenie do kubernetes klastra', 'strength' => 5]);
        Node::create(['type' => 'skill', 'label' => 'Kubernetes deployment', 'description' => 'nasadenie do kubernetes klastra', 'strength' => 1]);

        $before = Node::count();

        $this->artisan('mind:automerge')->assertSuccessful();

        $this->assertSame($before, Node::count(), 'automerge nesmie zlúčiť ani jeden uzol');
        $this->assertGreaterThan(0, MergeCandidate::pending()->count());
    }

    public function test_scan_finds_duplicates_that_are_already_in_the_network(): void
    {
        // uzly vzniknuté ešte pred zavedením fronty — mind_learn ich už nikdy
        // znovu neprejde a automerge ich nevidí, lebo sú rôzneho typu
        Node::create(['type' => 'skill', 'label' => 'Tracking page UX', 'strength' => 1]);
        Node::create(['type' => 'memory', 'label' => 'Tracking page UX', 'strength' => 1]);
        Node::create(['type' => 'project', 'label' => 'Niečo iné', 'strength' => 1]);

        $this->assertSame(0, MergeCandidate::count());

        $this->artisan('mind:duplicates', ['--scan' => true])->assertSuccessful();

        $this->assertSame(1, MergeCandidate::count());
        $this->assertSame('cross_type_slug', MergeCandidate::firstOrFail()->reason);

        // opakovaný scan nesmie vyrobiť druhý návrh na ten istý pár
        $this->artisan('mind:duplicates', ['--scan' => true])->assertSuccessful();
        $this->assertSame(1, MergeCandidate::count());
    }

    public function test_duplicates_command_merges_only_when_asked(): void
    {
        $winner = Node::create(['type' => 'skill', 'label' => 'Alfa', 'strength' => 9]);
        $loser = Node::create(['type' => 'skill', 'label' => 'Alfa duplikát', 'strength' => 1]);

        $candidate = $this->mind->recordMergeCandidate($winner, $loser, 96, 'cosine');

        $this->artisan('mind:duplicates')->assertSuccessful();
        $this->assertNotNull(Node::find($loser->id), 'samotný výpis nesmie nič zlúčiť');

        $this->artisan('mind:duplicates', ['--merge' => $candidate->id])->assertSuccessful();

        $this->assertNull(Node::find($loser->id), 'slabší uzol sa zlúčil');
        $this->assertNotNull(Node::withTrashed()->find($loser->id), 'a zlúčenie je vratné');
        $this->assertSame(MergeCandidate::STATUS_MERGED, $candidate->fresh()->status);
    }
}
