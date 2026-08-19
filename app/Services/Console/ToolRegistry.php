<?php

namespace App\Services\Console;

use App\Services\Console\Tools\ConsoleTool;
use App\Services\Console\Tools\EditFileTool;
use App\Services\Console\Tools\GlobTool;
use App\Services\Console\Tools\GrepTool;
use App\Services\Console\Tools\MindDeleteTool;
use App\Services\Console\Tools\MindLearnTool;
use App\Services\Console\Tools\MindMoveTool;
use App\Services\Console\Tools\MindOverviewTool;
use App\Services\Console\Tools\MindReadTool;
use App\Services\Console\Tools\MindRecallTool;
use App\Services\Console\Tools\MindRenameTool;
use App\Services\Console\Tools\NarrowsAllowance;
use App\Services\Console\Tools\ReadFileTool;
use App\Services\Console\Tools\BashTool;
use App\Services\Console\Tools\ToolRefusal;
use App\Services\Console\Tools\WriteFileTool;
use App\Services\Console\Tools\WriteReportTool;
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
        // zápis — parkuje sa na potvrdenie človekom
        MindLearnTool::class,
        MindRenameTool::class,
        MindMoveTool::class,
        MindDeleteTool::class,
        EditFileTool::class,
        WriteFileTool::class,
        WriteReportTool::class,
        // `bash` je ÚPLNE POSLEDNÝ a je to zámer, nie abeceda: je to najsilnejší
        // tool v registri a poradie je pre slabý model návod, po čom siahnuť
        // najskôr. Otázku „čo je v pamäti" má vyriešiť recall, nie `cat`.
        BashTool::class,
    ];

    /** @var array<string, ConsoleTool> meno → tool, v poradí self::TOOLS */
    protected array $tools = [];

    /**
     * @param  array<int, ConsoleTool>|null  $tools  vlastná sada (testy); `null` = kánon z {@see self::TOOLS}
     */
    public function __construct(?array $tools = null)
    {
        foreach ($tools ?? array_map(fn (string $class) => app($class), self::TOOLS) as $tool) {
            $this->tools[$tool->name()] = $tool;
        }
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
     * Zužuje tento tool „povoliť vždy" na kľúč?
     *
     * Kontrola je `instanceof`, nie meno toolu: rozhodnutie „tento tool je
     * priširoký na plošné povolenie" patrí k toolu, nie do smyčky. Keby to
     * smyčka riešila zoznamom mien, každý nový mocný tool by ten zoznam musel
     * niekto nájsť a doplniť — a nedoplnil by.
     *
     * Smyčka to potrebuje odlíšiť od {@see self::allowanceKey()} vracajúceho
     * `null`: „tool zúženie nepozná" znamená plošné povolenie, ale „tool ho pozná
     * a kľúč sa nedal vypočítať" nesmie povoliť nič. Bez tohto rozdielu by sa
     * `bash` s chýbajúcim argumentom povolil plošne — teda presne naopak, než má.
     *
     * Neznámy tool nezužuje: `drain()` ho aj tak nevykoná (`has()` je tam prvá
     * podmienka) a `call()` naň vráti odmietnutie so zoznamom toolov.
     */
    public function narrowsAllowance(string $name): bool
    {
        return $this->has($name) && $this->tools[$name] instanceof NarrowsAllowance;
    }

    /**
     * Kľúč, na ktorý sa má zúžiť „povoliť vždy" — alebo `null`, keď tool zúženie
     * neponúka (vtedy povolenie platí na celé vlákno, dnešné `auto_accept`),
     * alebo keď sa z argumentov vypočítať nedá (vtedy sa nepovolí nič).
     *
     * @param  array<string, mixed>  $args
     */
    public function allowanceKey(string $name, array $args): ?string
    {
        $tool = $this->has($name) ? $this->tools[$name] : null;

        if (! $tool instanceof NarrowsAllowance) {
            return null;
        }

        try {
            return $tool->allowanceKey($args);
        } catch (Throwable $e) {
            // Zlyhaný výpočet kľúča nesmie povoliť nič — a nesmie ani zhodiť ťah.
            report($e);

            return null;
        }
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
