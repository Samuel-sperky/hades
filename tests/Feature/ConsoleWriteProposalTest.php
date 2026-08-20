<?php

namespace Tests\Feature;

use App\Models\ConsoleThread;
use App\Models\ConsoleWriteProposal;
use App\Services\Console\AgentRunner;
use App\Services\Console\HeadlessRunner;
use App\Services\Console\SystemPrompt;
use App\Services\Console\ToolRegistry;
use App\Services\Console\ToolResult;
use App\Services\Console\Tools\ConsoleTool;
use App\Services\Console\Tools\UnifiedDiff;
use App\Services\Console\Tools\WriteFileTool;
use App\Services\Console\WriteProposals;
use App\Services\Llm\LlmProvider;
use App\Services\Llm\LlmResponse;
use App\Services\Llm\LlmToolCall;
use App\Services\Llm\OllamaProvider;
use App\Services\Llm\ProviderFactory;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Front odložených zápisov — čo sa stane, keď agent chce zapisovať v behu, pri
 * ktorom nikto nie je.
 *
 * Overuje sa TROJKA, ktorá musí platiť naraz, inak to celé nemá zmysel: zápis sa
 * NEVYKONÁ, ťah NEZAPARKUJE a návrh sa ZAZNAMENÁ s čitateľným náhľadom. Prvé dve
 * sú si na prvý pohľad blízke, ale sú to dve rôzne poruchy: nevykonaný zápis
 * v zaparkovanom vlákne je trvalo zablokované vlákno (o tom je celý
 * {@see HeadlessRunner}), a vykonaný zápis v nezaparkovanom
 * vlákne je nočný beh, ktorý ticho prepisuje súbory.
 *
 * Sada NEVOLÁ skutočný model. Poskytovateľ je fake naviazaný na miesto
 * {@see OllamaProvider}; tooly sú väčšinou fake a implementujú
 * {@see ConsoleTool} priamo — presne ako v {@see ConsoleRunTest}, takže do
 * kontraktu toolu netreba pridávať metódu (to je aj dôvod, prečo je
 * `SafeUnattended` marker interface a nie metóda).
 *
 * Register behu sa tu skladá RUČNE tak, ako ho zloží zapojenie v
 * `HeadlessRunner::registry()`: zápisový tool sa obalí
 * {@see WriteProposals::proposalTool()}. Testuje sa teda tá istá dvojica objektov
 * a to isté volanie, aké spraví headless beh — bez toho, aby test závisel od
 * súboru, ktorý vlastní integrátor.
 */
class ConsoleWriteProposalTest extends TestCase
{
    use RefreshDatabase;

    /** Koreň pre súborové tooly — mimo repa, aby test nemohol nič prepísať. */
    private string $root;

    protected function setUp(): void
    {
        parent::setUp();

        config(['cache.default' => 'array']);
        config(['hades.console.provider' => 'ollama']);

        $this->root = sys_get_temp_dir().'/hades-proposals-'.bin2hex(random_bytes(6));
        mkdir($this->root, 0o777, true);
        config(['hades.console.files_root' => $this->root]);
    }

    protected function tearDown(): void
    {
        foreach ((array) glob($this->root.'/*') as $file) {
            @unlink((string) $file);
        }
        @rmdir($this->root);

        parent::tearDown();
    }

    // ---- záznam namiesto vykonania -----------------------------------------

    public function test_unattended_write_is_recorded_and_the_turn_ends_normally(): void
    {
        $thread = ConsoleThread::create([]);
        $write = $this->fakeTool('mind_learn', write: true, display: 'Uzol vytvorený.', preview: 'nový uzol: Klietka');
        $this->canon([$write]);

        $this->fakeProvider([
            new LlmResponse(toolCalls: [new LlmToolCall('c1', 'mind_learn', ['label' => 'Klietka'])], stopReason: LlmResponse::STOP_TOOL_USE),
            new LlmResponse(text: 'Navrhol som uzol Klietka.'),
        ]);

        $frames = $this->drive($thread, 'Nauč sa, čo je klietka', $this->unattended([$write], $thread));

        // 1. nič sa nevykonalo
        $this->assertSame(0, $write->executed, 'Zápisový tool sa v behu bez človeka nesmie vykonať.');

        // 2. ťah NEZAPARKOVAL — žiadny `permission` a na konci je `end`
        $this->assertNull($this->frame($frames, 'permission'), 'Beh bez človeka sa nesmie zaparkovať.');
        $this->assertSame('end', $frames[count($frames) - 1]['t']);

        // 3. návrh je vo fronte a model o tom vie z výsledku toolu
        $proposal = ConsoleWriteProposal::firstOrFail();
        $this->assertSame('mind_learn', $proposal->name);
        $this->assertSame(['label' => 'Klietka'], $proposal->arguments);
        $this->assertSame(ConsoleWriteProposal::STATUS_PENDING, $proposal->status);
        $this->assertSame($thread->id, $proposal->thread_id);
        $this->assertNull($proposal->decided_at);

        $result = $this->frame($frames, 'tool_result');
        $this->assertSame('done', $result['status']);
        $this->assertStringContainsString('NOT EXECUTED', $result['result']);
        $this->assertStringContainsString($proposal->uuid, $result['result']);
    }

    /**
     * Toto je dôvod, prečo front vôbec existuje. `pending` riadok
     * v `console_tool_calls` znamená zaparkované vlákno: podľa neho
     * {@see ConsoleThread::pendingToolCall()} odmietne ďalšiu správu, takže by sa
     * do vlákna nedalo poslať ani ďalšia otázka a odblokovať by ho vedel len
     * človek v UI.
     */
    public function test_a_recorded_proposal_leaves_the_thread_usable(): void
    {
        $thread = ConsoleThread::create([]);
        $write = $this->fakeTool('write_file', write: true, display: 'zapísané');
        $this->canon([$write]);

        $this->fakeProvider([
            new LlmResponse(toolCalls: [new LlmToolCall('c1', 'write_file', ['path' => 'a.txt', 'content' => 'x'])], stopReason: LlmResponse::STOP_TOOL_USE),
            new LlmResponse(text: 'Navrhnuté.'),
        ]);

        $this->drive($thread, 'Zapíš to', $this->unattended([$write], $thread));

        $this->assertNull($thread->fresh()->pendingToolCall(), 'Návrh nesmie po sebe nechať zaparkované vlákno.');
        $this->assertDatabaseHas('console_tool_calls', ['call_id' => 'c1', 'status' => 'done']);
    }

    /**
     * Náhľad musí byť diff a musí ho vyrobiť {@see UnifiedDiff}
     * — preto je v tomto teste SKUTOČNÝ `write_file`, nie fake. Bez náhľadu je
     * návrh riadok, o ktorom sa nedá rozhodnúť.
     */
    public function test_a_file_proposal_carries_a_diff_and_leaves_the_file_alone(): void
    {
        $thread = ConsoleThread::create([]);
        file_put_contents($this->root.'/note.txt', "prvý\ndruhý\n");

        $tool = app(WriteFileTool::class);
        $this->canon([$tool]);

        $this->fakeProvider([
            new LlmResponse(
                toolCalls: [new LlmToolCall('c1', 'write_file', ['path' => 'note.txt', 'content' => "prvý\nTRETÍ\n"])],
                stopReason: LlmResponse::STOP_TOOL_USE,
            ),
            new LlmResponse(text: 'Navrhol som zmenu note.txt.'),
        ]);

        $this->drive($thread, 'Prepíš note.txt', $this->unattended([$tool], $thread));

        $proposal = ConsoleWriteProposal::firstOrFail();
        $this->assertStringContainsString('+++ b/note.txt', (string) $proposal->preview);
        $this->assertStringContainsString('+TRETÍ', (string) $proposal->preview);
        $this->assertStringContainsString('-druhý', (string) $proposal->preview);

        // súbor je nedotknutý — to je celý zmysel
        $this->assertSame("prvý\ndruhý\n", file_get_contents($this->root.'/note.txt'));
    }

    // ---- rozhodnutie -------------------------------------------------------

    /**
     * Povolenie ide TOU ISTOU cestou ako klik v UI: {@see ToolRegistry::call()}.
     * Tu to je vidieť na disku — po `approve` je súbor prepísaný obsahom
     * z návrhu, hoci ho medzitým nikto nepísal.
     */
    public function test_approve_executes_the_proposal_through_the_registry(): void
    {
        $thread = ConsoleThread::create([]);
        file_put_contents($this->root.'/note.txt', "starý\n");
        $this->canon([app(WriteFileTool::class)]);

        $proposals = app(WriteProposals::class);
        $proposals->record($thread, 'write_file', ['path' => 'note.txt', 'content' => "nový\n"]);

        $uuid = ConsoleWriteProposal::firstOrFail()->uuid;
        $decided = $proposals->approve($uuid);

        $this->assertSame(ConsoleWriteProposal::STATUS_APPROVED, $decided->status);
        $this->assertNotNull($decided->decided_at);
        $this->assertStringContainsString('note.txt', (string) $decided->result);
        $this->assertSame("nový\n", file_get_contents($this->root.'/note.txt'));
    }

    /**
     * Druhé `approve` je pri `mind_delete` alebo `write_file` rozdiel medzi „nič"
     * a „škoda" — riadok sa zaberie podmieneným UPDATE-om, takže druhé volanie
     * tool už nespustí.
     */
    public function test_approve_twice_executes_the_tool_only_once(): void
    {
        $thread = ConsoleThread::create([]);
        $tool = $this->fakeTool('mind_delete', write: true, display: 'Uzol zmazaný.');
        $this->canon([$tool]);

        $proposals = app(WriteProposals::class);
        $proposals->record($thread, 'mind_delete', ['node' => 'Klietka']);
        $uuid = ConsoleWriteProposal::firstOrFail()->uuid;

        $proposals->approve($uuid);
        $again = $proposals->approve($uuid);

        $this->assertSame(1, $tool->executed, 'Rozhodnutý návrh sa nesmie vykonať druhýkrát.');
        $this->assertSame(ConsoleWriteProposal::STATUS_APPROVED, $again->status);
        $this->assertSame('Uzol zmazaný.', $again->result);
    }

    public function test_deny_executes_nothing_and_switches_the_state(): void
    {
        $thread = ConsoleThread::create([]);
        $tool = $this->fakeTool('write_file', write: true, display: 'zapísané');
        $this->canon([$tool]);

        $proposals = app(WriteProposals::class);
        $proposals->record($thread, 'write_file', ['path' => 'a.txt', 'content' => 'x']);
        $uuid = ConsoleWriteProposal::firstOrFail()->uuid;

        $denied = $proposals->deny($uuid);

        $this->assertSame(ConsoleWriteProposal::STATUS_DENIED, $denied->status);
        $this->assertNotNull($denied->decided_at);
        $this->assertSame(0, $tool->executed);

        // a ani po zamietnutí sa už nedá vykonať
        $proposals->approve($uuid);
        $this->assertSame(0, $tool->executed, 'Zamietnutý návrh sa nesmie dať povoliť dodatočne.');
        $this->assertSame(ConsoleWriteProposal::STATUS_DENIED, $denied->fresh()->status);
    }

    /**
     * Neznáme uuid je chyba klienta, nie pád appky.
     * `ModelNotFoundException` framework renderuje ako 404 — bez `firstOrFail()`
     * by z toho bolo „Call to a member function on null", teda 500.
     */
    public function test_unknown_uuid_is_an_error_not_a_crash(): void
    {
        $proposals = app(WriteProposals::class);

        $this->expectException(ModelNotFoundException::class);
        $proposals->approve('00000000-0000-0000-0000-000000000000');
    }

    public function test_unknown_uuid_on_deny_is_an_error_too(): void
    {
        $this->expectException(ModelNotFoundException::class);

        app(WriteProposals::class)->deny('00000000-0000-0000-0000-000000000000');
    }

    // ---- fronta ------------------------------------------------------------

    /**
     * Slabý model po odpovedi „nič sa nevykonalo" ochotne skúsi to isté znova.
     * Bez tejto kontroly by človek rozhodoval o piatich kópiách jedného diffu.
     */
    public function test_the_same_write_proposed_twice_is_one_row(): void
    {
        $thread = ConsoleThread::create([]);
        $this->canon([$this->fakeTool('write_file', write: true, display: 'zapísané')]);

        $proposals = app(WriteProposals::class);
        $args = ['path' => 'a.txt', 'content' => 'x'];

        $proposals->record($thread, 'write_file', $args);
        $second = $proposals->record($thread, 'write_file', $args);

        $this->assertSame(1, ConsoleWriteProposal::count());
        $this->assertStringContainsString('Already queued', $second->text);
    }

    /** Fronta bez stropu je fronta, ktorú nikto neprejde. */
    public function test_the_queue_refuses_to_grow_past_the_cap(): void
    {
        $thread = ConsoleThread::create([]);
        $this->canon([$this->fakeTool('write_file', write: true, display: 'zapísané')]);
        config(['hades.console.proposals.max_open' => 2]);

        $proposals = app(WriteProposals::class);
        $proposals->record($thread, 'write_file', ['path' => 'a.txt', 'content' => 'x']);
        $proposals->record($thread, 'write_file', ['path' => 'b.txt', 'content' => 'x']);
        $third = $proposals->record($thread, 'write_file', ['path' => 'c.txt', 'content' => 'x']);

        $this->assertTrue($third->failed);
        $this->assertStringContainsString('queue is full', $third->text);
        $this->assertSame(2, ConsoleWriteProposal::count());
    }

    public function test_list_open_returns_the_queue_oldest_first_without_decided_rows(): void
    {
        $thread = ConsoleThread::create([]);
        $this->canon([$this->fakeTool('write_file', write: true, display: 'zapísané')]);

        $proposals = app(WriteProposals::class);
        $proposals->record($thread, 'write_file', ['path' => 'prvy.txt', 'content' => 'x']);
        $proposals->record($thread, 'write_file', ['path' => 'druhy.txt', 'content' => 'x']);

        $proposals->deny(ConsoleWriteProposal::query()->orderBy('id')->firstOrFail()->uuid);

        $list = $proposals->listOpen();

        $this->assertSame(1, $list['total']);
        $this->assertCount(1, $list['proposals']);
        $this->assertSame('druhy.txt', $list['proposals'][0]['arguments']['path']);
        $this->assertSame($thread->uuid, $list['proposals'][0]['thread']);
        $this->assertSame('pending', $list['proposals'][0]['status']);

        // neznáme vlákno má vrátiť prázdnu frontu, nie celú
        $this->assertSame(0, $proposals->listOpen('00000000-0000-0000-0000-000000000000')['total']);
    }

    // ---- pomôcky -----------------------------------------------------------

    /**
     * Kánonický register do kontejnera. Cez ten si {@see WriteProposals} berie
     * náhľad pri zápise návrhu a vykonanie pri jeho povolení — headless sada by
     * na to nestačila, tá zápisové tooly zámerne nemá.
     *
     * @param  array<int, ConsoleTool>  $tools
     */
    private function canon(array $tools): void
    {
        $this->app->instance(ToolRegistry::class, new ToolRegistry(array_values($tools)));
    }

    /**
     * Register behu bez človeka — presne to, čo zloží zapojenie v
     * `HeadlessRunner::registry()`: zápisový tool sa obalí do návrhu, čítací
     * zostane, ako je.
     *
     * @param  array<int, ConsoleTool>  $tools
     */
    private function unattended(array $tools, ConsoleThread $thread): ToolRegistry
    {
        $proposals = app(WriteProposals::class);

        return new ToolRegistry(array_map(
            fn (ConsoleTool $tool): ConsoleTool => $tool->isWrite()
                ? $proposals->proposalTool($tool, $thread)
                : $tool,
            array_values($tools),
        ));
    }

    /**
     * Jeden ťah cez skutočnú smyčku s daným registrom a zber rámcov.
     *
     * `new AgentRunner(...)` a nie ten z kontejnera: register si smyčka berie
     * v konštruktore, takže inak sa vlastná sada nedá podstrčiť — je to ten istý
     * postup, aký používa {@see HeadlessRunner}.
     *
     * @return list<array<string, mixed>>
     */
    private function drive(ConsoleThread $thread, string $message, ToolRegistry $registry): array
    {
        $frames = [];

        $runner = new AgentRunner(app(ProviderFactory::class), app(SystemPrompt::class), $registry);
        $runner->run($thread, $message, function (array $frame) use (&$frames): void {
            $frames[] = $frame;
        });

        return $frames;
    }

    /**
     * @param  list<array<string, mixed>>  $frames
     * @return array<string, mixed>|null
     */
    private function frame(array $frames, string $type): ?array
    {
        foreach ($frames as $frame) {
            if ($frame['t'] === $type) {
                return $frame;
            }
        }

        return null;
    }

    /**
     * Fake poskytovateľ na miesto Ollamy — `ProviderFactory` si ho berie
     * z kontejnera.
     *
     * @param  list<LlmResponse>  $script
     */
    private function fakeProvider(array $script): void
    {
        $fake = new class($script) implements LlmProvider
        {
            public function __construct(private array $script) {}

            public function name(): string
            {
                return OllamaProvider::NAME;
            }

            public function models(): array
            {
                return ['fake:1'];
            }

            public function available(): bool
            {
                return true;
            }

            public function chat(array $messages, array $options = []): LlmResponse
            {
                return $this->next(null);
            }

            public function stream(array $messages, array $options, callable $onDelta): LlmResponse
            {
                return $this->next($onDelta);
            }

            private function next(?callable $onDelta): LlmResponse
            {
                $step = array_shift($this->script) ?? new LlmResponse(text: 'Hotovo.');

                if ($onDelta !== null && $step->text !== '') {
                    foreach (mb_str_split($step->text, 4) as $chunk) {
                        $onDelta($chunk);
                    }
                }

                return $step;
            }
        };

        $this->app->instance(OllamaProvider::class, $fake);
    }

    /**
     * Tool, ktorý si počíta vykonania — na tom stojí každý test o tom, že sa
     * nevykonal. Kontrakt implementuje priamo, takže nová povinná metóda
     * v {@see ConsoleTool} by ho rozbila; presne preto je `SafeUnattended`
     * marker interface a nie metóda.
     */
    private function fakeTool(string $name, bool $write, string $display, ?string $preview = null): ConsoleTool
    {
        return new class($name, $write, $display, $preview) implements ConsoleTool
        {
            public int $executed = 0;

            public function __construct(
                private string $toolName,
                private bool $write,
                private string $display,
                private ?string $previewText,
            ) {}

            public function name(): string
            {
                return $this->toolName;
            }

            public function description(): string
            {
                return 'fake tool';
            }

            public function schema(): array
            {
                return ['type' => 'object', 'properties' => []];
            }

            public function isWrite(): bool
            {
                return $this->write;
            }

            public function preview(array $args): ?string
            {
                return $this->previewText;
            }

            public function execute(array $args): ToolResult
            {
                $this->executed++;

                return ToolResult::ok($this->display);
            }
        };
    }
}
