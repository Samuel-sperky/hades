<?php

namespace Tests\Feature;

use App\Models\ConsoleThread;
use App\Models\Run;
use App\Serializers\Screen\DennikScreen;
use App\Serializers\Screen\DnesScreen;
use App\Serializers\Screen\KniznicaScreen;
use App\Serializers\Screen\KontrolaScreen;
use App\Serializers\Screen\RozhodnutiaScreen;
use App\Serializers\Screen\RunDetailScreen;
use App\Serializers\Screen\RunsScreen;
use App\Serializers\Screen\SmernicaScreen;
use App\Serializers\ScreenSerializer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\AssertionFailedError;
use Tests\TestCase;

/**
 * Dvojitá plocha: obrazovka a MCP tool musia hovoriť to isté.
 *
 * Audit 19. 8. 2026 našiel, že appka má dnes tri miesta, kde sa plocha človeka
 * a plocha AI rozišli bez toho, aby to niekto zbadal — Smernica si markdown
 * skladá v prehliadači, hoci ho server posiela; Denník počíta projekty z 50
 * načítaných záznamov namiesto zo všetkých; `mind_recall` existuje v dvoch
 * implementáciách. Vždy to bola tá istá príčina: **dve implementácie jedného
 * obsahu.** Tento test je brána proti tretej.
 *
 * Stráži štyri veci:
 *
 *  1. **Pokrytie** — každá obrazovka v registri má serializér aj MCP tool.
 *  2. **Hodnoty** — tool a endpoint nad tou istou fixture: každý zdieľaný kľúč
 *     musí byť identický. Druhá implementácia = pád.
 *  3. **Kontrakt výberu** — `fieldsForAi()` nesmie menovať kľúč, ktorý `data()`
 *     nedáva. Preklep v zozname by inak ticho vyhodil pole z odpovede pre AI.
 *  4. **Citlivosť testu samého** — dokazuje sa OBOMA smermi: úmyselný rozchod
 *     musí padnúť, kozmetická zmena UI nesmie. Bez tejto štvrtej vrstvy by test
 *     mohol byť zelený aj vtedy, keby nemeral nič — presne tá pasca, na ktorú
 *     tento projekt už raz naletel (merač kreslenia obaľoval `clearRect`, ktorý
 *     render nepoužíva, a vracal vždy 0).
 *
 * Zámerne NEtestuje DOM, screenshoty, plurály, `timeAgo`, farby ani poradie
 * heatmapy — kozmetická zmena UI ho nesmie zhodiť, inak ho niekto vypne.
 */
class ScreenParityTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Register obrazoviek v parite. Nová obrazovka sa pridá SEM a test si ju
     * vynúti — to je jediné miesto, kde sa parita deklaruje.
     *
     * @return array<string, array{serializer: class-string<ScreenSerializer>, tool: string, route: string}>
     */
    private function registry(): array
    {
        return [
            'runy' => [
                'serializer' => RunsScreen::class,
                'tool' => 'mind_runs',
                'route' => 'api/runs',
            ],
            'run-detail' => [
                'serializer' => RunDetailScreen::class,
                'tool' => 'mind_run',
                'route' => 'api/runs/{uuid}',
            ],
            'dnes' => [
                'serializer' => DnesScreen::class,
                'tool' => 'mind_today',
                'route' => 'api/today',
            ],
            'dennik' => [
                'serializer' => DennikScreen::class,
                'tool' => 'mind_journal',
                'route' => 'api/journal',
            ],
            // Knižnica MUSÍ dostať na oboch stranách ten istý strop. Endpoint pre
            // človeka posiela všetko (1667 skillov, 508 kB), tool má vlastný
            // `AI_LIMIT` — porovnávať ich bez parametra by legitímne padlo na
            // `truncated` a `counts.shown`, čo nie je rozchod plôch, ale rozdiel
            // otázky. Test, ktorý padá na svojom vlastnom nastavení, sa vypne.
            'kniznica' => [
                'serializer' => KniznicaScreen::class,
                'tool' => 'mind_library',
                'route' => 'api/library',
                'query' => ['limit' => 200],
                'args' => ['limit' => 200],
            ],
            // Smernica stojí na `MindService::searchNodes`, ktorý používa
            // MariaDB-only `COLLATE utf8mb4_unicode_ci` (accent-insensitive LIKE).
            // Na sqlite padne celý dopyt, nie parita — preto sa preskakuje LEN
            // táto jedna obrazovka a len na sqlite, nie celý test. Na MariaDB
            // (`phpunit.mariadb.xml`) beží normálne a paritu Smernice navyše
            // testuje `ScreenSmernicaKniznicaTest` znak za znakom.
            'smernica' => [
                'serializer' => SmernicaScreen::class,
                'tool' => 'mind_directive',
                'route' => 'api/directive/build',
                'method' => 'post',
                'payload' => ['task' => 'docker'],
                'args' => ['task' => 'docker'],
                'requires_mariadb' => true,
            ],
            'rozhodnutia' => [
                'serializer' => RozhodnutiaScreen::class,
                'tool' => 'mind_decisions',
                'route' => 'api/decisions',
            ],
            'kontrola' => [
                'serializer' => KontrolaScreen::class,
                'tool' => 'mind_review',
                'route' => 'api/review/queue',
            ],
        ];
    }

    /**
     * Obrazovky, ktorých endpoint sa dá zavolať bez parametra — tie sa porovnávajú
     * generickou smyčkou, takže nová obrazovka v registri je pokrytá automaticky.
     * Detail s `{uuid}` má vlastný test, ktorý si fixture vyrobí sám.
     *
     * @return array<string, array{serializer: class-string<ScreenSerializer>, tool: string, route: string}>
     */
    private function listScreens(): array
    {
        return array_filter(
            $this->registry(),
            fn (array $pair): bool => ! str_contains($pair['route'], '{') && $this->runnableHere($pair),
        );
    }

    /**
     * Obrazovka, ktorá na tomto ovládači DB vôbec nemôže odpovedať, sa preskočí —
     * jedna taká nesmie zhodiť paritu ostatných siedmich.
     *
     * @param  array<string, mixed>  $pair
     */
    private function runnableHere(array $pair): bool
    {
        if (($pair['requires_mariadb'] ?? false) !== true) {
            return true;
        }

        return DB::connection()->getDriverName() !== 'sqlite';
    }

    // ---- 1. pokrytie -------------------------------------------------------

    public function test_every_screen_in_parity_has_both_a_tool_and_a_route(): void
    {
        $tools = collect($this->mcp('tools/list')['result']['tools'] ?? [])->pluck('name');
        $routes = collect(app('router')->getRoutes())->map(fn ($r) => $r->uri());

        foreach ($this->registry() as $screen => $pair) {
            $this->assertTrue(
                $tools->contains($pair['tool']),
                "Obrazovka {$screen} nemá MCP tool {$pair['tool']} — AI ju nevidí.",
            );
            $this->assertTrue(
                $routes->contains($pair['route']),
                "Obrazovka {$screen} nemá routu {$pair['route']} — človek ju nevidí.",
            );
        }
    }

    // ---- 3. kontrakt výberu (pred hodnotami: lacnejší a presnejší nález) ----

    public function test_the_ai_field_list_never_names_a_key_the_screen_does_not_have(): void
    {
        $this->seedRun();

        foreach ($this->registry() as $screen => $pair) {
            if (! $this->runnableHere($pair)) {
                continue;
            }

            $serializer = $this->build($pair['serializer'], $pair['args'] ?? []);
            $data = $serializer->data();

            foreach ($serializer->fieldsForAi() as $field) {
                [$root, $rowKey] = array_pad(explode('[].', $field, 2), 2, null);

                $this->assertArrayHasKey(
                    $root,
                    $data,
                    "Obrazovka {$screen} menuje pre AI kľúč `{$field}`, ktorý `data()` nedáva. ".
                    'Preklep v zozname by pole ticho vyhodil z odpovede pre AI.',
                );

                if ($rowKey === null) {
                    continue;
                }

                // Kontrola KOREŇOVÉHO kľúča nestačí: preklep vnútri riadku
                // (`items[].tokens_ouT`) prešiel oboma vrstvami a pole ticho zmizlo
                // z odpovede pre AI — teda presne to, čomu má táto vrstva brániť.
                $rows = array_values(array_filter((array) $data[$root], 'is_array'));

                if ($rows === []) {
                    continue;   // prázdna fixture o kľúčoch nič nedokazuje
                }

                $this->assertArrayHasKey(
                    $rowKey,
                    $rows[0],
                    "Obrazovka {$screen} menuje pre AI riadkový kľúč `{$field}`, ktorý riadok `data()` nedáva.",
                );
            }
        }
    }

    // ---- 2. hodnoty --------------------------------------------------------

    public function test_every_listed_screen_agrees_with_its_tool_on_every_shared_key(): void
    {
        $this->seedRun();

        foreach ($this->listScreens() as $screen => $pair) {
            $url = '/'.$pair['route'];

            if (($pair['query'] ?? []) !== []) {
                $url .= '?'.http_build_query($pair['query']);
            }

            $human = (($pair['method'] ?? 'get') === 'post'
                ? $this->postJson($url, $pair['payload'] ?? [])
                : $this->getJson($url))->assertOk()->json();

            $ai = $this->tool($pair['tool'], $pair['args'] ?? []);

            $this->assertParity(
                $human,
                $ai,
                "{$screen} → {$pair['tool']}",
                $this->declaredRoots($this->build($pair['serializer'], $pair['args'] ?? [])),
            );
        }
    }

    public function test_the_detail_endpoint_and_the_detail_tool_agree_on_every_shared_key(): void
    {
        $run = $this->seedRun();

        $human = $this->getJson('/api/runs/'.$run->uuid)->assertOk()->json();
        $ai = $this->tool('mind_run', ['uuid' => $run->uuid]);

        $this->assertParity($human, $ai, 'mind_run', $this->declaredRoots(new RunDetailScreen($run)));
    }

    public function test_the_detail_tool_refuses_an_unknown_run_instead_of_returning_an_empty_shape(): void
    {
        $answer = $this->mcp('tools/call', ['name' => 'mind_run', 'arguments' => ['uuid' => 'nie-je']]);

        $this->assertTrue($answer['result']['isError'], 'Neznámy beh musí byť chyba, nie prázdny detail.');
    }

    // ---- 4. citlivosť testu samého -----------------------------------------

    public function test_a_deliberate_divergence_is_caught(): void
    {
        $screen = new class extends ScreenSerializer
        {
            public function data(): array
            {
                return ['status' => 'done', 'tokens_out' => 42];
            }

            public function fieldsForAi(): array
            {
                return ['status', 'tokens_out'];
            }

            /** Druhá implementácia — presne to, čo má test chytiť. */
            public function forAi(): array
            {
                return ['status' => 'done', 'tokens_out' => 41];
            }
        };

        $failed = false;

        try {
            $this->assertParity($screen->data(), $screen->forAi(), 'fake');
        } catch (AssertionFailedError) {
            $failed = true;
        }

        $this->assertTrue($failed, 'Parity test nechytil rozchod hodnôt — potom nemeria nič.');
    }

    public function test_a_truncated_list_is_caught(): void
    {
        $screen = new class extends ScreenSerializer
        {
            public function data(): array
            {
                return ['items' => [['a' => 1], ['a' => 2], ['a' => 3]]];
            }

            public function fieldsForAi(): array
            {
                return ['items[].a'];
            }

            /** AI dostane dva riadky z troch — obrazovka a tool hovoria iné číslo. */
            public function forAi(): array
            {
                return ['items' => [['a' => 1], ['a' => 3]]];
            }
        };

        $this->assertParityFails($screen, 'skrátený zoznam');
    }

    public function test_a_missing_list_is_caught(): void
    {
        $screen = new class extends ScreenSerializer
        {
            public function data(): array
            {
                return ['total' => 3, 'items' => [['a' => 1]]];
            }

            public function fieldsForAi(): array
            {
                return ['total', 'items[].a'];
            }

            /** Zoznam vypadol celý; ostal len súčet, ktorý o ňom lže. */
            public function forAi(): array
            {
                return ['total' => 3];
            }
        };

        $this->assertParityFails($screen, 'chýbajúci zoznam');
    }

    public function test_a_cosmetic_ui_only_key_does_not_break_parity(): void
    {
        $screen = new class extends ScreenSerializer
        {
            public function data(): array
            {
                // `thread_title` a `spark` sú pre oko; AI ich nedostane a nemá to byť chyba.
                return ['status' => 'done', 'thread_title' => 'Ladenie grafu', 'spark' => [1, 2, 3]];
            }

            public function fieldsForAi(): array
            {
                return ['status'];
            }
        };

        $this->assertParity($screen->data(), $screen->forAi(), 'fake', $this->declaredRoots($screen));
    }

    // ---- pomôcky -----------------------------------------------------------

    /**
     * Parita MUSÍ na tomto serializéri padnúť. Bez tejto pomôcky by sa dôkazy
     * citlivosti písali `try/catch` päťkrát a jeden z nich by raz stíchol.
     */
    private function assertParityFails(ScreenSerializer $screen, string $what): void
    {
        try {
            $this->assertParity($screen->data(), $screen->forAi(), 'fake', $this->declaredRoots($screen));
        } catch (AssertionFailedError) {
            return;
        }

        $this->fail("Parity test nechytil rozchod typu {$what} — potom v tejto vrstve nemeria nič.");
    }

    /**
     * Každý kľúč, ktorý AI dostala, musí mať v ploche človeka identickú hodnotu.
     * Opačný smer sa nekontroluje zámerne — plocha človeka smie mať navyše
     * (`thread_title`, iskra do grafu), to je celý zmysel `fieldsForAi()`.
     *
     * @param  array<string, mixed>  $human
     * @param  array<string, mixed>  $ai
     */
    private function assertParity(array $human, array $ai, string $tool, array $declaredRoots = [], string $path = ''): void
    {
        // Iterovanie kľúčov AI samo nestačí: keď z odpovede vypadne CELÝ kľúč,
        // nie je čo iterovať a rozchod prejde zelene. Deklarované korene sa preto
        // kontrolujú zvlášť — ak ich obrazovka má a nie sú prázdne, AI ich musí
        // dostať tiež.
        if ($path === '') {
            foreach ($declaredRoots as $root) {
                // Preskočí sa presne to, čo `dropEmpty()` z odpovede pre AI maže:
                // `null`, prázdny string a prázdne pole. Inak by test padal na
                // legitímnom stave — napr. `q` je prázdne, kým sa nehľadá.
                if (! array_key_exists($root, $human)
                    || $human[$root] === [] || $human[$root] === null || $human[$root] === '') {
                    continue;
                }

                $this->assertArrayHasKey(
                    $root,
                    $ai,
                    "{$tool} nevracia `{$root}`, hoci ho obrazovka má a `fieldsForAi()` ho menuje.",
                );
            }
        }

        foreach ($ai as $key => $value) {
            $here = $path === '' ? (string) $key : "{$path}.{$key}";

            $this->assertArrayHasKey(
                $key,
                $human,
                "{$tool} vracia `{$here}`, ktoré obrazovka nemá — to je druhá implementácia.",
            );

            if (is_array($value) && is_array($human[$key])) {
                // Iterovať len kľúče AI nestačí: zoznam skrátený o riadok prešiel
                // zelene, hoci AI by potom o behu tvrdila „sú len dva". `dropEmpty`
                // riadok, ktorý sa vyprázdni, zahodí a zvyšok preindexuje — keď sa to
                // stane, nie je to kozmetika, ale zle zvolený `fieldsForAi()`.
                if (array_is_list($value) && array_is_list($human[$key])) {
                    $this->assertCount(
                        count($human[$key]),
                        $value,
                        "{$tool} vracia v `{$here}` iný počet riadkov než obrazovka.",
                    );
                }

                $this->assertParity($human[$key], $value, $tool, [], $here);

                continue;
            }

            $this->assertSame(
                $human[$key],
                $value,
                "{$tool} a obrazovka sa rozišli na `{$here}`.",
            );
        }
    }

    /**
     * Serializér v testovacom stave. Konstruktory sa líšia (detail chce beh, Dnes
     * si berie závislosť z kontejnera, zoznamy berú filtre), takže je to match —
     * nový serializér sa tu ohlási pádom, nie tichým prejdením.
     */
    /**
     * Koreňové kľúče, ktoré `fieldsForAi()` menuje — `items[].uuid` → `items`.
     *
     * @return list<string>
     */
    private function declaredRoots(ScreenSerializer $screen): array
    {
        $roots = array_map(
            static fn (string $field): string => explode('[].', $field, 2)[0],
            $screen->fieldsForAi(),
        );

        return array_values(array_unique($roots));
    }

    private function build(string $serializer, array $args = []): ScreenSerializer
    {
        return match ($serializer) {
            RunDetailScreen::class => new RunDetailScreen(Run::query()->latest('id')->firstOrFail()),
            DnesScreen::class => app(DnesScreen::class),
            default => new $serializer($args),
        };
    }

    private function seedRun(): Run
    {
        $thread = ConsoleThread::create([]);

        return Run::create([
            'thread_id' => $thread->id,
            'source' => 'console',
            'status' => 'done',
            'prompt' => 'nájdi poznatok o Dockeri',
            'provider' => 'ollama',
            'model' => 'qwen3:8b',
            'steps' => 2,
            'tool_calls' => 1,
            'tokens_in' => 3100,
            'tokens_out' => 240,
            'tokens_per_second' => 8.9,
            'duration_ms' => 27000,
            'stop_reason' => 'stop',
            'started_at' => now()->subMinute(),
            'ended_at' => now(),
        ]);
    }

    /**
     * Volanie MCP toolu tak, ako ho volá živá session — cez JSON-RPC, nie priamo
     * na metódu. Keby test volal metódu, prešel by aj vtedy, keď tool nie je
     * v `tools/list` a teda pre AI neexistuje.
     *
     * @return array<string, mixed>
     */
    private function tool(string $name, array $arguments): array
    {
        $answer = $this->mcp('tools/call', ['name' => $name, 'arguments' => $arguments]);

        $this->assertFalse(
            $answer['result']['isError'] ?? true,
            "Tool {$name} vrátil chybu: ".($answer['result']['content'][0]['text'] ?? '?'),
        );

        return json_decode($answer['result']['content'][0]['text'], true);
    }

    /** @return array<string, mixed> */
    private function mcp(string $method, array $params = []): array
    {
        return $this->postJson('/mcp', [
            'jsonrpc' => '2.0',
            'id' => 1,
            'method' => $method,
            'params' => $params,
        ], ['Authorization' => 'Bearer '.config('hades.mcp_token')])->json();
    }
}
