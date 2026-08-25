<?php

namespace Tests\Feature;

use App\Models\ConsoleThread;
use App\Models\ConsoleToolCall;
use App\Models\Run;
use App\Serializers\Screen\RunDetailScreen;
use App\Serializers\Screen\RunsScreen;
use App\Services\Console\RunRecorder;
use App\Services\Console\Subagent;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Strom podbehov — `runs.parent_run_id` na ploche človeka aj na ploche AI.
 *
 * Sada stráži tri veci, a všetky tri sú o **pravdivosti ceny behu**:
 *
 *  1. **Rodič vie o svojich deťoch a dieťa o svojom rodičovi.** Bez toho je log
 *     zoznam nesúvisiacich ťahov a ťah, ktorý delegoval, vyzerá lacnejšie, než bol.
 *  2. **Kroky a tool cally dieťaťa sa rodičovi NEPRIPOČÍTAVAJÚ.** Rámce dieťaťa
 *     idú cez `$emit` rodiča, takže je to jediná vlastnosť tohto stromu, ktorú sa
 *     dá pokaziť jedným slovom v `RunRecorder::STATEFUL` — a pokazila by sa ticho.
 *  3. **Segment sa nezatvára dvakrát.** `/decide` uzavrie podbeh v tele requestu
 *     a `finally` v `stream()` ho zavrie znova; bez ochrany by trvanie dieťaťa
 *     obsahovalo aj pokračovanie rodiča.
 *
 * Model tu nie je potrebný ani raz: recorder visí na `$emit`, takže sa testuje ten
 * istý povrch, ktorý vidí prehliadač — stačí mu poslať rámce.
 */
class RunTreeTest extends TestCase
{
    use RefreshDatabase;

    /** Poradové číslo `call_id` — deterministické, aby sa dva cally nikdy netrafili. */
    private int $calls = 0;

    // ---- plocha človeka aj AI ----------------------------------------------

    public function test_the_detail_lists_both_children_and_the_list_points_each_child_at_its_parent(): void
    {
        $parent = $this->makeParent();
        $first = $this->makeChild($parent, 'Prehľadaj public/js/shared.', steps: 3, toolCalls: 2, tokensOut: 214);
        $second = $this->makeChild($parent, 'Zhrň, čo je v docs/sprint-2026-08-25.', steps: 2, toolCalls: 1, tokensOut: 180);

        $detail = $this->getJson('/api/runs/'.$parent->uuid)->assertOk()->json();

        $this->assertCount(2, $detail['children'], 'Rodič má dva podbehy.');

        // Poradie je poradie spustenia (`id`), nie čas dokončenia: druhý podagent
        // môže dobehnúť skôr a strom by potom v UI preskakoval.
        $this->assertSame([$first->uuid, $second->uuid], array_column($detail['children'], 'uuid'));

        $this->assertSame(
            ['uuid', 'status', 'prompt', 'profile', 'steps', 'tool_calls', 'tokens_out', 'duration_ms'],
            array_keys($detail['children'][0]),
            'Tvar podbehu je súčasťou kontraktu vlny 1 — kľúč navyše ani chýbajúci nie je kozmetika.',
        );
        $this->assertSame('files', $detail['children'][0]['profile']);
        $this->assertSame(3, $detail['children'][0]['steps']);
        $this->assertSame(214, $detail['children'][0]['tokens_out']);

        // Rodič nemá rodiča — a v ploche človeka to je `null`, nie chýbajúci kľúč,
        // aby UI nemuselo tvar hádať.
        $this->assertNull($detail['parent']);

        $items = collect($this->getJson('/api/runs')->assertOk()->json('items'))->keyBy('uuid');

        $this->assertSame($parent->uuid, $items[$first->uuid]['parent']);
        $this->assertSame($parent->uuid, $items[$second->uuid]['parent']);
        $this->assertNull($items[$parent->uuid]['parent'], 'Beh, ktorý začal človek, nemá rodiča.');
    }

    public function test_the_ai_surface_omits_the_parent_it_does_not_have_and_carries_the_tree_it_does(): void
    {
        $parent = $this->makeParent();
        $child = $this->makeChild($parent, 'Prehľadaj repo.');

        $rows = collect((new RunsScreen([]))->forAi()['items'])->keyBy('uuid');

        // Prázdne polia sa AI neposielajú — `null` je 20 B za nulovú informáciu
        // a význam vynechania („začal to človek") patrí do popisu nástroja.
        $this->assertArrayNotHasKey('parent', $rows[$parent->uuid]);
        $this->assertSame($parent->uuid, $rows[$child->uuid]['parent']);

        $ai = (new RunDetailScreen($parent))->forAi();

        $this->assertCount(1, $ai['children']);
        $this->assertSame($child->uuid, $ai['children'][0]['uuid']);
        $this->assertArrayNotHasKey('parent', $ai, 'Rodič bez rodiča — pole sa vynechá.');

        // A obrátene: detail podbehu ukazuje hore. Bez toho by sa z uuid dieťaťa
        // (ktoré `spawn_agent` vracia modelu) nedalo dostať k ťahu, čo ho zadal.
        $this->assertSame($parent->uuid, (new RunDetailScreen($child))->forAi()['parent']);
    }

    public function test_an_empty_tree_stays_out_of_the_ai_answer_entirely(): void
    {
        $ai = (new RunDetailScreen($this->makeParent()))->forAi();

        // Beh bez podagentov nesmie platiť `"children":[]`. Je to zároveň dôkaz, že
        // parity test smie na prázdnom zozname preskakovať — presne to robí.
        $this->assertArrayNotHasKey('children', $ai);
        $this->assertSame([], (new RunDetailScreen($this->makeParent()))->data()['children']);
    }

    // ---- cena behu ---------------------------------------------------------

    public function test_the_steps_of_a_child_are_never_added_to_its_parent(): void
    {
        $recorder = app(RunRecorder::class);
        $subagent = app(Subagent::class);

        $parentThread = ConsoleThread::create([]);
        $parentRun = $recorder->open($parentThread, 'rozdeľ prácu', ['profile' => 'orchestrator']);
        $call = $this->spawnCall($parentThread);

        $childThread = ConsoleThread::create(['parent_thread_id' => $parentThread->id, 'tool_profile' => 'files']);
        $childRun = $recorder->openChild($childThread, $parentRun, $call, 'prehľadaj repo', ['profile' => 'files']);

        $parentEmit = $recorder->wrap($parentRun, static function (array $frame): void {});
        $childEmit = $recorder->wrap($childRun, $subagent->envelope($childRun, $parentEmit));

        $childEmit(['t' => 'step', 'n' => 1, 'of' => 4]);
        $childEmit(['t' => 'tool', 'name' => 'grep']);
        $childEmit(['t' => 'step', 'n' => 2, 'of' => 4]);

        // Dieťa si svoje kroky započítalo — počíta ich PRED zabalením do obálky.
        $this->assertSame(2, $childRun->fresh()->steps);
        $this->assertSame(1, $childRun->fresh()->tool_calls);

        // A rodičovi sa nepripočítalo nič, hoci všetky tri rámce prešli jeho `$emit`.
        $this->assertSame(0, $parentRun->fresh()->steps, 'Kroky dieťaťa sa pripočítali rodičovi — cena behu prestala byť pravdivá.');
        $this->assertSame(0, $parentRun->fresh()->tool_calls);

        // KALIBRÁCIA: ten istý rámec BEZ obálky rodičovi počítadlo zdvihne. Bez
        // tejto polovice by test prešel aj vtedy, keby počítadlo nefungovalo vôbec
        // — a presne na takú pascu tento projekt už raz naletel.
        $parentEmit(['t' => 'step', 'n' => 1, 'of' => 12]);
        $this->assertSame(1, $parentRun->fresh()->steps, 'Počítadlo krokov rodiča nemeria nič — test potom nedokazuje nič.');
    }

    public function test_agent_wait_parks_the_parent_while_the_other_agent_frames_leave_it_running(): void
    {
        $recorder = app(RunRecorder::class);

        $thread = ConsoleThread::create([]);
        $run = $recorder->open($thread, 'rozdeľ prácu', ['profile' => 'orchestrator']);

        // `agent_start` a `agent_end` sú oznámenia o dieťati, nie stav rodiča.
        $recorder->observe($run, ['t' => 'agent_start', 'run' => 'x', 'task' => 't', 'profile' => 'files']);
        $recorder->observe($run, ['t' => 'agent', 'run' => 'x', 'frame' => ['t' => 'permission', 'id' => 1]]);
        $recorder->observe($run, ['t' => 'agent_end', 'run' => 'x', 'status' => 'done']);

        $this->assertSame('running', $run->fresh()->status, 'Rámce o dieťati nesmú prepnúť stav rodiča.');

        // `agent_wait` je POSLEDNÝ rámec zaparkovaného ťahu rodiča — `end` po ňom
        // nepríde. Bez tejto vetvy by beh zostal `running`, `close()` by ho
        // v `finally` uzavrel ako `done` a `/decide` by nemalo čo obnoviť.
        $recorder->observe($run, ['t' => 'agent_wait', 'run' => 'x', 'child_call' => 9, 'name' => 'write_file']);
        $this->assertSame('waiting', $run->fresh()->status);

        $recorder->close($run);

        $this->assertSame('waiting', $run->fresh()->status, 'Zaparkovaný beh sa nezatvára.');
        $this->assertNull($run->fresh()->ended_at, 'Inak by trvanie rodiča meralo, ako dlho sa človek rozhodoval.');
    }

    public function test_closing_a_child_twice_does_not_stretch_its_duration_over_the_parents_continuation(): void
    {
        $recorder = app(RunRecorder::class);

        $parentThread = ConsoleThread::create([]);
        $parentRun = $recorder->open($parentThread, 'rozdeľ prácu');
        $call = $this->spawnCall($parentThread);

        $childThread = ConsoleThread::create(['parent_thread_id' => $parentThread->id]);
        $childRun = $recorder->openChild($childThread, $parentRun, $call, 'prehľadaj repo');

        $recorder->observe($childRun, ['t' => 'end', 'stop_reason' => 'stop']);
        $recorder->close($childRun);

        $firstClose = $childRun->fresh();
        $this->assertSame('done', $firstClose->status);
        $this->assertNotNull($firstClose->ended_at);

        // Rodič medzitým dopovedá — a `finally` v `stream()` zavrie dieťa druhý raz.
        $this->travel(3)->minutes();
        $recorder->close($childRun);

        $this->assertSame(
            $firstClose->ended_at->toIso8601String(),
            $childRun->fresh()->ended_at->toIso8601String(),
            'Druhé zatvorenie prepísalo koniec podbehu — jeho trvanie by obsahovalo pokračovanie rodiča.',
        );
        $this->assertSame($firstClose->duration_ms, $childRun->fresh()->duration_ms);
    }

    public function test_a_child_run_records_where_it_came_from(): void
    {
        $recorder = app(RunRecorder::class);

        $parentThread = ConsoleThread::create([]);
        $parentRun = $recorder->open($parentThread, 'rozdeľ prácu');
        $call = $this->spawnCall($parentThread);

        $childThread = ConsoleThread::create(['parent_thread_id' => $parentThread->id]);
        $childRun = $recorder->openChild($childThread, $parentRun, $call, 'prehľadaj repo', ['profile' => 'files']);

        $this->assertSame('agent', $childRun->source, '`source` odlišuje podbeh od ťahu, ktorý začal človek.');
        $this->assertSame($parentRun->id, $childRun->parent_run_id);
        $this->assertSame($call->id, $childRun->parent_call_id, 'Na tomto kľúči stojí idempotencia `spawn_agent`.');
        $this->assertSame('files', $childRun->tool_profile);
        $this->assertSame('prehľadaj repo', $childRun->prompt, '`runs.prompt` nesie úlohu, nie brief — inak „Spustiť znovu" vráti preambulu.');
        $this->assertTrue($childRun->isChild());
        $this->assertFalse($parentRun->fresh()->isChild());
    }

    // ---- pomôcky -----------------------------------------------------------

    private function makeParent(): Run
    {
        return Run::create([
            'thread_id' => ConsoleThread::create([])->id,
            'source' => 'console',
            'status' => 'done',
            'prompt' => 'Rozdeľ prácu medzi podagentov.',
            'provider' => 'ollama',
            'model' => 'qwen3:8b',
            'tool_profile' => 'orchestrator',
            'steps' => 2,
            'tool_calls' => 1,
            'tokens_in' => 2600,
            'tokens_out' => 90,
            // Wall clock rodiča, ktorý čakal na dieťa aj na človeka. Trvanie detí
            // NIE JE jeho položka — segmenty sa prekrývajú, takže sčítať ani
            // odčítať sa nedajú.
            'duration_ms' => 240_000,
            'started_at' => now()->subMinutes(5),
            'ended_at' => now(),
        ]);
    }

    private function makeChild(
        Run $parent,
        string $task,
        int $steps = 2,
        int $toolCalls = 1,
        int $tokensOut = 200,
    ): Run {
        return Run::create([
            'thread_id' => ConsoleThread::create(['parent_thread_id' => $parent->thread_id])->id,
            'parent_run_id' => $parent->id,
            'parent_call_id' => $this->spawnCall($parent->thread)->id,
            'source' => 'agent',
            'status' => 'done',
            'prompt' => $task,
            'provider' => 'ollama',
            'model' => 'qwen3:8b',
            'tool_profile' => 'files',
            'steps' => $steps,
            'tool_calls' => $toolCalls,
            'tokens_in' => 1840,
            'tokens_out' => $tokensOut,
            'duration_ms' => 41_000,
            'started_at' => now()->subMinutes(4),
            'ended_at' => now()->subMinutes(3),
        ]);
    }

    private function spawnCall(ConsoleThread $thread): ConsoleToolCall
    {
        return ConsoleToolCall::create([
            'thread_id' => $thread->id,
            'call_id' => 'c'.(++$this->calls),
            'name' => 'spawn_agent',
            'arguments' => ['task' => 'prehľadaj repo', 'profile' => 'files'],
            'status' => 'running',
        ]);
    }
}
