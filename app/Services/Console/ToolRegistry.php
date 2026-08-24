<?php

namespace App\Services\Console;

use App\Services\Console\Tools\ConsoleTool;
use App\Services\Console\Tools\EditFileTool;
use App\Services\Console\Tools\GlobTool;
use App\Services\Console\Tools\GraphFocusTool;
use App\Services\Console\Tools\GrepTool;
use App\Services\Console\Tools\MindDeleteTool;
use App\Services\Console\Tools\MindLearnTool;
use App\Services\Console\Tools\MindMoveTool;
use App\Services\Console\Tools\MindOverviewTool;
use App\Services\Console\Tools\MindReadTool;
use App\Services\Console\Tools\MindRecallTool;
use App\Services\Console\Tools\MindRenameTool;
use App\Services\Console\Tools\ReadFileTool;
use App\Services\Console\Tools\ToolRefusal;
use App\Services\Console\Tools\WriteFileTool;
use App\Services\Llm\LlmProvider;
use Throwable;

/**
 * Register toolov konzoly — jediné miesto, ktoré agentová smyčka volá.
 *
 * Zodpovednosti sú tu rozdelené naschvál takto: register vie, KTORÉ tooly
 * existujú a KTORÉ z nich sú zápisové; smyčka vie, čo s tým. Keby si smyčka
 * vyberala tool sama (`match ($name)`), pridanie toolu by znamenalo zmenu
 * v smyčke — a práve tam sa zabudne na `isWrite()`.
 *
 * `call()` NIKDY nehodí výnimku. Model musí dostať výsledok na každé volanie:
 * keď mu tool spadne bez odpovede, buď to skúsi znova (na CPU inferencii to je
 * ~20 sekúnd za nič), alebo si výsledok vymyslí. Preto sa všetko prekladá na
 * `ToolResult::refused()` s vetou, z ktorej sa dá pokračovať.
 *
 * PORADIE {@see self::TOOLS} nie je kozmetika. V takomto poradí ich model vidí
 * v systémovom prompte a slabý model siaha na to, čo je vyššie — takže čítanie
 * je vpredu a zápis vzadu.
 *
 * **`TOOLS` je kánon toho, čo EXISTUJE (13); {@see self::PROFILES} je kánon toho,
 * čo sa VYSTAVUJE.** Nie sú to tie isté množiny: `graph_focus` existuje, ale
 * profil `full` ho nemá (jeho efekt je klientský a `/console` plátno nemá).
 * Beh dostane len tooly svojho profilu — filtruje sa advertising ({@see self::definitions()})
 * aj vykonanie ({@see self::call()}), pretože model si tool pamätá z histórie
 * vlákna a keby sa filtroval len popis, zavolal by ho a vykonal.
 */
class ToolRegistry
{
    /** @var array<int, class-string<ConsoleTool>> */
    public const TOOLS = [
        // čítanie — beží bez pýtania
        MindRecallTool::class,
        MindReadTool::class,
        MindOverviewTool::class,
        GrepTool::class,
        GlobTool::class,
        ReadFileTool::class,
        GraphFocusTool::class,
        // zápis — parkuje sa na potvrdenie človekom
        MindLearnTool::class,
        MindRenameTool::class,
        MindMoveTool::class,
        MindDeleteTool::class,
        EditFileTool::class,
        WriteFileTool::class,
    ];

    /**
     * Profily — bezpečnostne tvarovaný zoznam toho, ktoré tooly beh vystaví.
     *
     * Je to konštanta v KÓDE, nie config: členstvo rozhoduje o tom, ktoré
     * ZÁPISOVÉ tooly v behu vôbec existujú, a to patrí vedľa {@see self::TOOLS},
     * kde ho `ConsoleToolsTest` pripne menovite. V `.env` by ho netestoval nikto
     * a preklep by ticho odobral (alebo pridal) zápisový tool. Do configu ide len
     * meno defaultného profilu (`hades.console.profile`).
     *
     * Poradie v každom profile drží pravidlo „čítanie vpredu, zápis vzadu"
     * (slabý model siaha na to, čo je vyššie). `graph_focus` je čítací.
     *
     * ŽIADNY `bash`/`shell` tool v žiadnom profile (kontrakt §4: appka je verejne
     * tunelovaná cez ngrok). Vynucuje to `TOOLS` a menovitý zoznam v teste.
     *
     * @var array<string, array<int, class-string<ConsoleTool>>>
     */
    public const PROFILES = [
        // Pamäť bez súborov. Kurátorstvo vedomia sa súborov projektu nedotýka —
        // a `read_file`/PathGuard je najväčšia riziková plocha, ktorú netreba
        // vystavovať behu, ktorý ju nepotrebuje.
        'memory' => [
            MindRecallTool::class, MindReadTool::class, MindOverviewTool::class,
            MindLearnTool::class, MindRenameTool::class, MindMoveTool::class, MindDeleteTool::class,
        ],

        // Súbory + JEDEN čítací tool pamäte. `mind_recall` tu JE zámerne: smernica
        // modelu prikazuje „nič si nedomýšľaj, zisti to toolom", a konvencie
        // projektu žijú v pamäti. Profil bez recallu by model nútil vymýšľať.
        'files' => [
            MindRecallTool::class,
            GrepTool::class, GlobTool::class, ReadFileTool::class,
            EditFileTool::class, WriteFileTool::class,
        ],

        // Dok nad plátnom. Čítanie pamäte + navigácia grafu + `mind_learn`.
        // `mind_learn` tu MUSÍ byť: bez zápisového toolu by sa dvojfázová brána
        // v doku nedala ani spustiť, teda ani overiť. Súborové tooly tu NIE SÚ:
        // dok je nad grafom, nie nad repozitárom.
        'graph' => [
            MindRecallTool::class, MindReadTool::class, MindOverviewTool::class,
            GraphFocusTool::class,
            MindLearnTool::class,
        ],

        // Plná konzola (/console). Dnešná dvanástka, znak po znaku.
        // `graph_focus` tu NIE JE — jeho efekt je klientský a konzola plátno nemá.
        'full' => [
            MindRecallTool::class, MindReadTool::class, MindOverviewTool::class,
            GrepTool::class, GlobTool::class, ReadFileTool::class,
            MindLearnTool::class, MindRenameTool::class, MindMoveTool::class,
            MindDeleteTool::class, EditFileTool::class, WriteFileTool::class,
        ],
    ];

    /** @var array<string, ConsoleTool> celý kánon, meno → tool */
    protected array $all = [];

    /** @var array<string, ConsoleTool> aktívna podmnožina podľa profilu */
    protected array $tools = [];

    protected ?string $profile = null;

    /** Bol register postavený z kánonu, alebo mu sadu podstrčil test? */
    protected bool $canon;

    /**
     * @param  array<int, ConsoleTool>|null  $tools  vlastná sada (testy); `null` = kánon z {@see self::TOOLS}
     */
    public function __construct(?array $tools = null)
    {
        $this->canon = $tools === null;

        foreach ($tools ?? array_map(fn (string $class) => app($class), self::TOOLS) as $tool) {
            $this->all[$tool->name()] = $tool;
        }

        $this->tools = $this->all;

        // Kánon sa hneď zúži na default profil — bez tohto by `/console` (ktorý
        // register berie z kontajnera) vystavil aj `graph_focus`.
        if ($this->canon) {
            $this->useProfile((string) config('hades.console.profile', 'full'));
        }
    }

    /**
     * Zúži aktívnu sadu na jeden profil.
     *
     * Neznámy profil je ODMIETNUTIE, nie fallback — ten istý duch ako v
     * {@see \App\Services\Console\Tools\PathGuard}: fallback na `full` by dal behu
     * viac toolov (vrátane zápisových), než volajúci žiadal (tichý únik
     * oprávnenia); fallback na menší profil by model nechal povedať „taký nástroj
     * nemám" a človek by hľadal chybu v modeli. Odmietnutie je jediná možnosť,
     * ktorá nevie zalhať.
     *
     * @throws \InvalidArgumentException neznámy profil
     */
    public function useProfile(string $profile): void
    {
        if (! isset(self::PROFILES[$profile])) {
            throw new \InvalidArgumentException(
                "Unknown tool profile `{$profile}`. Available: ".implode(', ', array_keys(self::PROFILES)).'.'
            );
        }

        $this->profile = $profile;

        // Podstrčená sada (testy fake toolov) sa NEFILTRUJE. Filtrovanie kánonom
        // by ju vyprázdnilo a ConsoleRunTest by ostal zelený bez toho, aby čokoľvek
        // meral — presne tá pasca, na ktorú tento projekt raz naletel.
        if (! $this->canon) {
            return;
        }

        $keep = self::PROFILES[$profile];
        $this->tools = array_filter(
            $this->all,
            fn (ConsoleTool $tool): bool => in_array($tool::class, $keep, true)
        );
    }

    /** Meno aktívneho profilu (alebo `null`, keď register nie je z kánonu). */
    public function activeProfile(): ?string
    {
        return $this->profile;
    }

    /**
     * Celý kánon bez ohľadu na profil — pre testy tvaru, ktoré overujú vlastnosť
     * KAŽDÉHO toolu, nie profilu.
     *
     * @return array<int, string>
     */
    public function allNames(): array
    {
        return array_keys($this->all);
    }

    /**
     * Definície v tvare, ktorý čaká {@see LlmProvider}
     * (`input_schema`; Ollama to isté volá `parameters` a vrstva to prekladá).
     *
     * @return array<int, array{name: string, description: string, input_schema: array<string, mixed>}>
     */
    public function definitions(): array
    {
        return array_values(array_map(fn (ConsoleTool $tool) => [
            'name' => $tool->name(),
            'description' => $tool->description(),
            'input_schema' => $this->schemaOf($tool),
        ], $this->tools));
    }

    /** @return array<int, string> */
    public function names(): array
    {
        return array_keys($this->tools);
    }

    public function has(string $name): bool
    {
        return isset($this->tools[$name]);
    }

    /**
     * @throws ToolRefusal keď tool neexistuje — text je pre model, nech si vyberie z ponuky
     */
    public function get(string $name): ConsoleTool
    {
        if (! isset($this->tools[$name])) {
            throw new ToolRefusal(
                "Unknown tool `{$name}`. Available tools: ".implode(', ', $this->names()).'.'
            );
        }

        return $this->tools[$name];
    }

    /**
     * Musí tento tool pred vykonaním potvrdiť človek?
     *
     * Neznámy tool je zápisový. Fail-closed: keby vrátil `false`, preklep v mene
     * (alebo tool zabudnutý v `TOOLS`) by prešiel bez potvrdenia.
     */
    public function isWrite(string $name): bool
    {
        return $this->has($name) ? $this->tools[$name]->isWrite() : true;
    }

    /**
     * Náhľad pre potvrdzovacie okno. Nikdy nehodí výnimku — odmietnutie sa vráti
     * ako text náhľadu, aby človek videl, PREČO nemá čo potvrdzovať, namiesto
     * prázdneho dialógu.
     *
     * @param  array<string, mixed>  $args
     */
    public function preview(string $name, array $args): ?string
    {
        try {
            return $this->get($name)->preview($args);
        } catch (ToolRefusal $e) {
            return $e->getMessage();
        } catch (Throwable $e) {
            report($e);

            return 'Náhľad sa nepodarilo pripraviť: '.$e->getMessage();
        }
    }

    /**
     * Vykoná tool a vráti výsledok — vždy, aj pri chybe.
     *
     * @param  array<string, mixed>  $args
     */
    public function call(string $name, array $args): ToolResult
    {
        $started = hrtime(true);

        try {
            $result = $this->get($name)->execute($args);
        } catch (ToolRefusal $e) {
            // Očakávané odmietnutie (zlá cesta, nejednoznačný string, odpadový
            // label). Nelogujeme ako chybu appky — je to normálna súčasť behu.
            $result = ToolResult::refused($e->getMessage());
        } catch (\InvalidArgumentException $e) {
            // Validácia z MindService (neznáma oblasť, prázdny názov). Text je
            // po anglicky aj slovensky podľa miesta vzniku, ale vždy vecný.
            $result = ToolResult::refused('Refused: '.$e->getMessage());
        } catch (Throwable $e) {
            // Skutočná porucha. Model dostane triedu chyby, nie stack trace —
            // trace by mu zjedol kontext a neporadil s ničím.
            report($e);
            $result = ToolResult::refused(
                'Tool `'.$name.'` failed: '.class_basename($e).': '.$e->getMessage()
            );
        }

        $result->durationMs = (int) round((hrtime(true) - $started) / 1_000_000);

        return $result;
    }

    /**
     * PASCA: prázdne `properties` sa v JSON-e zakódujú ako `[]`, teda ako POLE, a
     * schéma prestane byť platná (`properties` musí byť objekt). Postihuje to
     * `mind_overview`, ktorý nemá argumenty — a niektorí poskytovatelia takú
     * schému odmietnu celú, teda model stratí VŠETKY tooly, nielen ten jeden.
     *
     * @return array<string, mixed>
     */
    protected function schemaOf(ConsoleTool $tool): array
    {
        $schema = $tool->schema();

        if (($schema['properties'] ?? []) === []) {
            $schema['properties'] = new \stdClass;
        }

        return $schema;
    }
}
