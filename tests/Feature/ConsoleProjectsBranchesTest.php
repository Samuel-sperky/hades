<?php

namespace Tests\Feature;

use App\Models\ConsoleBranch;
use App\Models\ConsoleMessage;
use App\Models\ConsoleProject;
use App\Models\ConsoleThread;
use App\Models\ConsoleToolCall;
use App\Models\Run;
use App\Services\Console\RunRecorder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Projekty (zložky vlákien) a vetvenie konverzácie — `/chat`.
 *
 * Sada testuje **chovanie, nie schému**. Zelená sada nad `Schema::hasColumn()`
 * by dokázala len to, že migrácia vytvorila stĺpce; tu ide o to, čo sa stane, keď
 * človek zmaže zložku, odbočí vo vlákne alebo zmaže pobočku — teda o cudzie
 * kľúče, ktoré `phpunit.xml` beží na sqlite a ticho vynechané pravidlo by inak
 * nechalo sadu zelenú (viď docblock `keep_runs_when_a_thread_is_deleted`).
 *
 * Tri veci sú tu **pinované** a nie len overené:
 *
 *  1. **Exkluzivita behu je na úrovni VLÁKNA, nie vetvy.** Kto povolí súbežný beh
 *     dvoch vetiev jedného vlákna, rozbije každý rozsah
 *     `from_message_id`–`to_message_id` v tom vlákne — beh by hlásil cenu cudzieho
 *     ťahu a v detaile ukázal cudzie správy.
 *  2. **Skládanie histórie jednej vetvy je JEDEN `SELECT` bez CTE**, nie rekurzia
 *     v SQL a nie dopyt na vetvu.
 *  3. **Okno histórie sa počíta nad reťazou vetvy, nie nad `thread_id`.** Bez toho
 *     by model dostal do kontextu správy z opustenej vetvy — a padlo by to ticho,
 *     pretože z pohľadu vlákna sú to úplne platné správy.
 */
class ConsoleProjectsBranchesTest extends TestCase
{
    use RefreshDatabase;

    // ---- projekty ----------------------------------------------------------

    public function test_a_project_is_created_renamed_pinned_and_archived(): void
    {
        $uuid = $this->postJson('/api/console/projects', ['name' => '  Hades  '])
            ->assertCreated()
            // Názov sa trimuje na serveri: vedúca medzera by v paneli vyzerala
            // ako odsadený riadok a v radení by projekt padol na začiatok.
            ->assertJsonPath('name', 'Hades')
            ->assertJsonPath('pinned', false)
            ->assertJsonPath('threads', 0)
            ->json('uuid');

        $this->patchJson("/api/console/projects/{$uuid}", ['name' => 'Charón', 'pinned' => true])
            ->assertOk()
            ->assertJsonPath('name', 'Charón')
            ->assertJsonPath('pinned', true);

        $this->assertNotNull(ConsoleProject::where('uuid', $uuid)->value('pinned_at'));

        // Opakované pripnutie čas NEPREPISUJE — poradie pripnutých je poradie
        // pripnutia, nie poradie posledného kliku.
        //
        // Čas sa posúva do minulosti RUČNE: do 2. 9. 2026 tu stálo porovnanie
        // hodnoty pred a po druhom `PATCH`i, a keďže oba padli do tej istej
        // sekundy, `now()` dal to isté a asercia prešla aj kódu, ktorý čas
        // prepisuje. Zmerané na mutantovi `? now() : null` v oboch kontroléroch.
        ConsoleProject::where('uuid', $uuid)->update(['pinned_at' => '2026-01-01 00:00:00']);

        $this->patchJson("/api/console/projects/{$uuid}", ['pinned' => true])->assertOk();
        $this->assertSame(
            '2026-01-01 00:00:00',
            ConsoleProject::where('uuid', $uuid)->value('pinned_at')->toDateTimeString(),
        );

        $this->patchJson("/api/console/projects/{$uuid}", ['archived' => true])
            ->assertOk()
            ->assertJsonPath('archived', true);

        $this->patchJson("/api/console/projects/{$uuid}", ['archived' => false])
            ->assertOk()
            ->assertJsonPath('archived', false);

        $this->assertNull(ConsoleProject::where('uuid', $uuid)->value('archived_at'));
    }

    /** Pripnuté zhora (najnovšie pripnutie prvé), zvyšok podľa mena — a radí to SQL. */
    public function test_the_panel_order_puts_pinned_projects_first(): void
    {
        ConsoleProject::create(['name' => 'Zeta']);
        ConsoleProject::create(['name' => 'Alfa']);
        ConsoleProject::create(['name' => 'Pripnutý', 'pinned_at' => now()]);

        $names = collect($this->getJson('/api/console/projects')->assertOk()->json('projects'))
            ->pluck('name')
            ->all();

        $this->assertSame(['Pripnutý', 'Alfa', 'Zeta'], $names);
    }

    /**
     * Vlákno patrí najviac do JEDNÉHO projektu. Nie je to konvencia klienta:
     * vzťah nesie jeden stĺpec, takže druhé zaradenie je presun, nie duplikát.
     */
    public function test_a_thread_belongs_to_at_most_one_project(): void
    {
        $first = ConsoleProject::create(['name' => 'Prvý']);
        $second = ConsoleProject::create(['name' => 'Druhý']);
        $thread = ConsoleThread::create([]);

        $this->postJson("/api/console/projects/{$first->uuid}/threads", ['thread' => $thread->uuid])->assertOk();
        $this->postJson("/api/console/projects/{$second->uuid}/threads", ['thread' => $thread->uuid])->assertOk();

        $this->assertSame($second->id, $thread->fresh()->project_id);
        $this->assertSame(0, $first->threads()->count());

        $this->deleteJson("/api/console/projects/{$second->uuid}/threads/{$thread->uuid}")->assertOk();
        $this->assertNull($thread->fresh()->project_id);
    }

    /** Vlákno z iného projektu sa nedá vyradiť pod hlavičkou toho tohto. */
    public function test_detaching_a_thread_from_a_foreign_project_is_refused(): void
    {
        $mine = ConsoleProject::create(['name' => 'Môj']);
        $other = ConsoleProject::create(['name' => 'Cudzí']);
        $thread = ConsoleThread::create(['project_id' => $other->id]);

        $this->deleteJson("/api/console/projects/{$mine->uuid}/threads/{$thread->uuid}")->assertNotFound();
        $this->assertSame($other->id, $thread->fresh()->project_id);
    }

    /**
     * **Zmazanie zložky má vlákna vysypať, nie spáliť.** Cudzí kľúč je
     * `nullOnDelete`; s kaskádou by jeden klik zmazal všetky konverzácie v projekte.
     */
    public function test_deleting_a_project_keeps_its_threads(): void
    {
        $project = ConsoleProject::create(['name' => 'Na zmazanie']);
        $thread = ConsoleThread::create(['project_id' => $project->id]);
        ConsoleMessage::create(['thread_id' => $thread->id, 'role' => 'user', 'content' => 'Ahoj']);

        $this->deleteJson("/api/console/projects/{$project->uuid}")->assertOk();

        $survivor = $thread->fresh();

        $this->assertNotNull($survivor, 'Zmazanie projektu zmazalo vlákno — cudzí kľúč kaskáduje.');
        $this->assertNull($survivor->project_id);
        $this->assertSame(1, $survivor->messages()->count());
    }

    // ---- vetvenie ----------------------------------------------------------

    /**
     * Odbočenie dedí prefix PRED editovanou správou a **pôvodná vetva zostáva**
     * čitateľná so svojím pokračovaním.
     */
    public function test_forking_inherits_the_prefix_and_leaves_the_original_readable(): void
    {
        [$thread, $root, $m] = $this->seedThread();

        $forked = $this->postJson("/api/console/threads/{$thread->uuid}/branches", ['message' => $m[2]->id])
            ->assertCreated()
            ->assertJsonPath('forked_from_message_id', $m[1]->id)
            ->json('uuid');

        $thread->refresh();

        // Nová vetva: dedený prefix, nič z opustenej vetvy.
        $this->assertSame(
            [$m[0]->id, $m[1]->id],
            $thread->branchMessages()->orderBy('id')->pluck('id')->all()
        );

        // Upravená správa je prvý VLASTNÝ záznam novej vetvy. Zapisuje ju bežný
        // beh, tu ju len dosadíme na jeho miesto.
        $edited = ConsoleMessage::create([
            'thread_id' => $thread->id,
            'branch_id' => $thread->currentBranchId(),
            'role' => 'user',
            'content' => 'A čo Z?',
        ]);

        $this->assertSame(
            [$m[0]->id, $m[1]->id, $edited->id],
            $thread->branchMessages()->orderBy('id')->pluck('id')->all()
        );

        // Pôvodná vetva je po prepnutí presne taká, aká bola — a upravená správa
        // v nej nie je.
        $this->postJson("/api/console/branches/{$root->uuid}/activate")
            ->assertOk()
            ->assertJsonPath('active', $root->uuid);

        $thread->refresh();

        $this->assertSame(
            [$m[0]->id, $m[1]->id, $m[2]->id, $m[3]->id],
            $thread->branchMessages()->orderBy('id')->pluck('id')->all()
        );

        $this->assertNotSame($forked, $root->uuid);
    }

    /**
     * Reťaz troch vetiev. Toto je test, ktorý zachytí zámenu stropov: strop
     * článku je `forked_from_message_id` jeho DIEŤAŤA, nie jeho vlastný, a pri
     * dvoch úrovniach sa taká zámena ešte nemusí prejaviť.
     */
    public function test_the_chain_holds_across_three_levels(): void
    {
        [$thread, , $m] = $this->seedThread();

        // 1. odbočenie pred m[2] → dedí m0, m1
        $this->postJson("/api/console/threads/{$thread->uuid}/branches", ['message' => $m[2]->id])->assertCreated();
        $thread->refresh();

        $second = ConsoleMessage::create([
            'thread_id' => $thread->id, 'branch_id' => $thread->currentBranchId(),
            'role' => 'user', 'content' => 'Druhý pokus',
        ]);
        $secondAnswer = ConsoleMessage::create([
            'thread_id' => $thread->id, 'branch_id' => $thread->currentBranchId(),
            'role' => 'assistant', 'content' => 'Odpoveď na druhý',
        ]);

        // 2. odbočenie pred `second` → dedí m0, m1 (a nič z druhej vetvy)
        $this->postJson("/api/console/threads/{$thread->uuid}/branches", ['message' => $second->id])->assertCreated();
        $thread->refresh();

        $third = ConsoleMessage::create([
            'thread_id' => $thread->id, 'branch_id' => $thread->currentBranchId(),
            'role' => 'user', 'content' => 'Tretí pokus',
        ]);

        $ids = $thread->branchMessages()->orderBy('id')->pluck('id')->all();

        $this->assertSame([$m[0]->id, $m[1]->id, $third->id], $ids);
        $this->assertNotContains($second->id, $ids);
        $this->assertNotContains($secondAnswer->id, $ids);
        $this->assertNotContains($m[2]->id, $ids);
    }

    /**
     * Editácia PRVEJ správy vlákna nededí nič — a to je `forked_from_message_id`
     * **0**, nie `null`. `null` je vyhradené korennej vetve a znamená „bez
     * stropu"; keby sa sem dostal, nová vetva by dostala celú pôvodnú konverzáciu.
     */
    public function test_forking_at_the_first_message_inherits_nothing(): void
    {
        [$thread, , $m] = $this->seedThread();

        $this->postJson("/api/console/threads/{$thread->uuid}/branches", ['message' => $m[0]->id])
            ->assertCreated()
            ->assertJsonPath('forked_from_message_id', 0);

        $thread->refresh();

        $this->assertSame([], $thread->branchMessages()->orderBy('id')->pluck('id')->all());
    }

    /**
     * **Skládanie histórie jednej vetvy je jeden `SELECT` nad `console_messages`
     * a jeden nad `console_branches` — bez rekurzie a bez CTE.**
     *
     * Meria sa to počítaním dopytov, nie prečítaním kódu: dopyt na vetvu v cykle
     * je chyba, ktorá funguje a je vidieť len na profile.
     */
    public function test_history_of_one_branch_is_a_single_select_without_cte(): void
    {
        [$thread, , $m] = $this->seedThread();
        $this->postJson("/api/console/threads/{$thread->uuid}/branches", ['message' => $m[2]->id])->assertCreated();
        $thread->refresh();

        $queries = [];
        DB::listen(function ($query) use (&$queries): void {
            $queries[] = $query->sql;
        });

        $thread->branchMessages()->orderBy('id')->get();

        $messageQueries = array_values(array_filter($queries, fn (string $sql) => str_contains($sql, 'console_messages')));
        $branchQueries = array_values(array_filter($queries, fn (string $sql) => str_contains($sql, 'console_branches')));

        $this->assertCount(1, $messageQueries, 'História vetvy sa skládá viac než jedným dopytom nad správami.');
        $this->assertCount(1, $branchQueries, 'Reťaz vetiev sa čítá dopytom v cykle, nie jedným SELECTom.');
        $this->assertStringNotContainsStringIgnoringCase('recursive', implode(' ', $queries));
    }

    /**
     * Presne ten dopyt, ktorý bude robiť `AgentRunner::history()`: okno posledných
     * `history_window` replík **nad reťazou vetvy**, nie nad `thread_id`.
     *
     * Toto je najdôležitejší test celej sady. Okno nad `thread_id` je zelené
     * v každom inom teste — vráti platné správy platného vlákna. Len sú z vetvy,
     * ktorú človek opustil, a model podľa nich odpovie na otázku, ktorá už nie je
     * na obrazovke.
     */
    public function test_the_history_window_is_counted_over_the_branch_chain(): void
    {
        [$thread, , $m] = $this->seedThread();

        $this->postJson("/api/console/threads/{$thread->uuid}/branches", ['message' => $m[2]->id])->assertCreated();
        $thread->refresh();

        $edited = ConsoleMessage::create([
            'thread_id' => $thread->id, 'branch_id' => $thread->currentBranchId(),
            'role' => 'user', 'content' => 'Iná otázka',
        ]);

        $window = 2;

        $rows = $thread->branchMessages()
            ->whereIn('role', ['user', 'assistant'])
            ->orderByDesc('id')
            ->limit($window)
            ->get()
            ->reverse()
            ->values();

        $this->assertSame([$m[1]->id, $edited->id], $rows->pluck('id')->all());

        // Okno nad `thread_id` by na tomto mieste vrátilo opustenú vetvu.
        $wrong = $thread->messages()
            ->whereIn('role', ['user', 'assistant'])
            ->orderByDesc('id')
            ->limit($window)
            ->get()
            ->pluck('id')
            ->all();

        $this->assertContains($m[3]->id, $wrong, 'Kalibrácia: bez reťaze vetvy by okno vrátilo správy z opustenej vetvy.');
    }

    /** Vetviť sa dá len od vlastnej správy — editácia odpovede modelu by bola prepísanie histórie. */
    public function test_forking_from_an_assistant_message_is_refused(): void
    {
        [$thread, , $m] = $this->seedThread();

        $this->postJson("/api/console/threads/{$thread->uuid}/branches", ['message' => $m[1]->id])
            ->assertStatus(422);

        $this->assertSame(1, $thread->branches()->count());
    }

    /** Správa z cudzieho vlákna nesmie založiť vetvu, ktorá dedí prefix odinakiaľ. */
    public function test_forking_from_a_foreign_message_is_refused(): void
    {
        [$thread] = $this->seedThread();
        [, , $other] = $this->seedThread();

        $this->postJson("/api/console/threads/{$thread->uuid}/branches", ['message' => $other[2]->id])
            ->assertNotFound();
    }

    /**
     * Korennú vetvu zmazať nemožno: kaskáda by s ňou vzala celú konverzáciu, čo je
     * „zmazať vlákno" pod iným menom.
     */
    public function test_the_root_branch_cannot_be_deleted(): void
    {
        [$thread, $root] = $this->seedThread();

        $this->deleteJson("/api/console/branches/{$root->uuid}")->assertStatus(422);

        $this->assertSame(4, $thread->messages()->count());
    }

    /**
     * Zmazanie vetvy vezme jej správy (kaskáda), ale **`runs` zostávajú** — log
     * behov má prežiť zmazanie toho, o čom hovorí. `runs.branch_id` je bez
     * cudzieho kľúča, takže z neho zostane čitateľný visiaci ukazovateľ.
     */
    public function test_deleting_a_branch_takes_its_messages_but_keeps_the_runs(): void
    {
        [$thread, , $m] = $this->seedThread();

        $branchUuid = $this->postJson("/api/console/threads/{$thread->uuid}/branches", ['message' => $m[2]->id])
            ->assertCreated()
            ->json('uuid');

        $thread->refresh();
        $branch = ConsoleBranch::where('uuid', $branchUuid)->firstOrFail();

        $own = ConsoleMessage::create([
            'thread_id' => $thread->id, 'branch_id' => $branch->id,
            'role' => 'user', 'content' => 'Vlastná správa vetvy',
        ]);

        // `branch_id` sa nastavuje priamo, nie cez `create()`: v `Run::$fillable`
        // zatiaľ nie je (stĺpec pridala migrácia vlny 1, model ho dostane s
        // koľajou, ktorá píše podbehy) a hromadné priradenie by ho ticho zahodilo.
        $run = Run::create([
            'thread_id' => $thread->id,
            'status' => 'done',
            'prompt' => 'Otázka',
            'from_message_id' => $own->id,
            'to_message_id' => $own->id,
        ]);
        $run->branch_id = $branch->id;
        $run->save();

        $this->deleteJson("/api/console/branches/{$branchUuid}")->assertOk();

        $this->assertNull(ConsoleMessage::find($own->id), 'Správy zmazanej vetvy prežili — kaskáda nevznikla.');
        $this->assertNull(ConsoleBranch::find($branch->id));

        $survivor = $run->fresh();

        $this->assertNotNull($survivor, 'Zmazanie vetvy zmazalo beh — `runs.branch_id` má cudzí kľúč, ktorý tam nemá byť.');
        $this->assertSame($branch->id, (int) $survivor->branch_id);

        // Mazala sa aktívna vetva → aktívnou je zase rodič, teda korenná.
        $this->assertSame($thread->branches()->first()->id, $thread->fresh()->active_branch_id);
    }

    /** Zmazanie vlákna vezme vetvy aj správy; `runs` zostávajú s `thread_id = null`. */
    public function test_deleting_a_thread_takes_the_branches_but_keeps_the_runs(): void
    {
        [$thread, $root, $m] = $this->seedThread();

        $run = Run::create([
            'thread_id' => $thread->id,
            'status' => 'done',
            'prompt' => 'Otázka',
            'from_message_id' => $m[0]->id,
            'to_message_id' => $m[3]->id,
        ]);

        $thread->delete();

        $this->assertSame(0, ConsoleBranch::where('id', $root->id)->count());
        $this->assertSame(0, ConsoleMessage::whereIn('id', collect($m)->pluck('id'))->count());

        $survivor = $run->fresh();

        $this->assertNotNull($survivor);
        $this->assertNull($survivor->thread_id);
    }

    // ---- exkluzivita behu --------------------------------------------------

    /**
     * **Exkluzivita behu je na úrovni VLÁKNA, nie vetvy.**
     *
     * Test drží presne tú optimalizáciu, ktorá sa niekomu bude zdať zjavná:
     * „veď to sú dve rôzne vetvy, môžu bežať súčasne". Nemôžu. `console_messages.id`
     * je globálny autoincrement a členstvo správ v behu nesie ROZSAH id, takže
     * dva súbežné behy v jednom vlákne si rozsahy prekryjú a každý z nich potom
     * hlási cenu toho druhého a v detaile ukazuje jeho správy.
     */
    public function test_two_branches_of_one_thread_cannot_run_at_the_same_time(): void
    {
        [$thread, $root, $m] = $this->seedThread();
        $recorder = app(RunRecorder::class);

        $first = $recorder->openExclusive($thread, 'Prvý ťah');

        $this->assertNotNull($first);

        // Beh drží korennú vetvu, aktívna je iná — a vlákno je aj tak zamknuté.
        $first->branch_id = $root->id;
        $first->save();

        $forked = ConsoleBranch::forkBefore($m[2]);
        $thread->active_branch_id = $forked->id;
        $thread->save();

        $this->assertNull(
            $recorder->openExclusive($thread->fresh(), 'Druhý ťah v druhej vetve'),
            'Vlákno pustilo druhý súbežný beh — rozsahy `from_message_id`–`to_message_id` sú odteraz nepresné.'
        );
    }

    /** Vlákno s nedorozhodnutým zápisom sa nevetví ani neprepína — brána drží celé vlákno. */
    public function test_a_parked_write_blocks_forking_and_switching(): void
    {
        [$thread, $root, $m] = $this->seedThread();

        ConsoleToolCall::create([
            'thread_id' => $thread->id,
            'message_id' => $m[3]->id,
            'call_id' => 'call-1',
            'name' => 'write_file',
            'arguments' => ['path' => 'README.md'],
            'status' => 'pending',
        ]);

        $this->postJson("/api/console/threads/{$thread->uuid}/branches", ['message' => $m[2]->id])
            ->assertStatus(409);

        $this->postJson("/api/console/branches/{$root->uuid}/activate")
            ->assertStatus(409);

        $this->assertSame(1, $thread->branches()->count());
    }

    /** Beh, ktorý sa pol hodiny neohlásil, padol s procesom a vlákno neblokuje. */
    public function test_a_dead_run_does_not_block_forking(): void
    {
        [$thread, , $m] = $this->seedThread();

        $run = Run::create(['thread_id' => $thread->id, 'status' => 'running', 'prompt' => 'Zabudnutý ťah']);
        // `updated_at` sa nastavuje bez modelu: `save()` by časovú značku prepísal
        // na teraz a beh by zostal „živý".
        DB::table('runs')->where('id', $run->id)->update(['updated_at' => now()->subHours(2)]);

        $this->postJson("/api/console/threads/{$thread->uuid}/branches", ['message' => $m[2]->id])
            ->assertCreated();
    }

    /** Živý beh vetvenie odmietne — a vráti 409, nie ticho nič neurobí. */
    public function test_a_live_run_blocks_forking(): void
    {
        [$thread, , $m] = $this->seedThread();

        Run::create(['thread_id' => $thread->id, 'status' => 'running', 'prompt' => 'Práve beží']);

        $this->postJson("/api/console/threads/{$thread->uuid}/branches", ['message' => $m[2]->id])
            ->assertStatus(409);
    }

    // ---- pomôcky -----------------------------------------------------------

    /**
     * Vlákno so štyrmi správami v korennej vetve: otázka, odpoveď, otázka,
     * odpoveď. Presne to, na čom sa vetvenie robí — človek sa vracia k svojej
     * druhej otázke.
     *
     * @return array{0: ConsoleThread, 1: ConsoleBranch, 2: list<ConsoleMessage>}
     */
    private function seedThread(): array
    {
        $thread = ConsoleThread::create([]);
        $root = ConsoleBranch::rootFor($thread);

        $messages = [];

        foreach ([
            ['user', 'Ako sa robí X?'],
            ['assistant', 'Takto sa robí X.'],
            ['user', 'A ako Y?'],
            ['assistant', 'Takto sa robí Y.'],
        ] as [$role, $content]) {
            $messages[] = ConsoleMessage::create([
                'thread_id' => $thread->id,
                'branch_id' => $root->id,
                'role' => $role,
                'content' => $content,
            ]);
        }

        return [$thread->fresh(), $root, $messages];
    }
}
