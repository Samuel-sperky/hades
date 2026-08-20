<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Skupina projektu — jedno miesto, ktoré rozhoduje, či názov projektu nesie
 * význam, alebo je to len strojový adresár.
 *
 * Claude Code zapisuje do `meta.project` názov pracovného adresára. Keď session
 * bežala v dočasnom adresári, je to generovaný slug („mystifying-mclaren-23750a"),
 * ktorý ako projekt nehovorí nič. Do 20. 8. 2026 to rozhodoval **prehliadač**
 * (`isMachineName()` v `util.js`, `journalKey()` v `dennik.js`) a dôsledok bol
 * presne ten, ktorý audit našiel: človek videl jednu skupinu „bez projektu",
 * kým AI dostala dvanásť uzlov s menami typu `mystifying-mclaren-23750a`.
 * Skupina je dátové rozhodnutie, nie kresba, takže patrí na server.
 *
 * Pravidlo je **doslovný port** toho klientskeho (dve slová malými + ≥5 znakov
 * alfanumerického chvosta, ktorý obsahuje číslicu), aby prenos nebol zmenou
 * chovania: na reálnom korpuse (44 názvov, 19. 8. 2026) klasifikuje tie isté 22.
 * Je zámerne úzke, aby nezožralo reálne názvy typu „sperky-ai" či „aura-prototype".
 *
 * Nie je to to isté pravidlo ako `MindService::noiseOf()` „slug" — to hľadá
 * strojový slug v **labeli uzla** a žiada presne šesťznakový hex chvost. Na
 * dnešnom korpuse sa obe zhodujú do jedného názvu, ale sú to dve otázky
 * (odpadový label × nezmyselný projekt) a zlúčiť ich by znamenalo, že zmena
 * jednej mlčky mení druhú.
 */
final class ProjectGroup
{
    /**
     * Kľúč skupiny „bez projektu". Mriežka sa v názvoch adresárov nevyskytuje,
     * takže sentinel sa nemôže zhodovať so žiadnym reálnym projektom — a klient
     * ho vie poslať späť ako filter, čo obyčajné `null` nedokáže.
     */
    public const NONE = '#bez-projektu';

    public const NONE_LABEL = 'bez projektu';

    private const MACHINE = '/^[a-z]{3,}-[a-z]{3,}-(?=[a-z0-9]*\d)[a-z0-9]{5,}$/';

    public static function isMachineName(?string $project): bool
    {
        return preg_match(self::MACHINE, trim((string) $project)) === 1;
    }

    /** Kľúč skupiny: reálny názov projektu, alebo sentinel. */
    public static function key(?string $project): string
    {
        $project = trim((string) $project);

        return ($project === '' || self::isMachineName($project)) ? self::NONE : $project;
    }

    /**
     * SQL výraz, ktorý vyberie názov projektu z `meta` — pre agregáty, kde sa
     * `meta->project` nedá napísať ako obyčajný stĺpec (`selectRaw`, `COALESCE`).
     *
     * Skladá ho **gramatika spojenia**, nie tento súbor: v MariaDB z toho vyjde
     * `json_value(…)`, v sqlite `json_extract(…)`, a testy tohto projektu bežia na
     * sqlite, kým appka na MariaDB. Natvrdo napísané `JSON_UNQUOTE(JSON_EXTRACT())`
     * (ako to mal `TodayController` a `JournalController`) je platné len na jednej
     * z nich, takže endpoint sa v testoch nedal vôbec zavolať.
     */
    public static function column(): string
    {
        return DB::connection()->getQueryGrammar()->wrap('meta->project');
    }

    /** Text, ktorý o skupine číta človek. */
    public static function label(?string $project): string
    {
        $key = self::key($project);

        return $key === self::NONE ? self::NONE_LABEL : $key;
    }
}
