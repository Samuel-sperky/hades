<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Rebranding identity Hades → AuraAI.
 *
 * KRITICKÉ: frontend hľadá centrálny hub uzol porovnaním `n.label === S.name`,
 * pričom `S.name` prichádza z API ako `config('auraai.name')`. Tá istá hodnota
 * teda musí byť v configu AJ v DB, inak sa graf rozsype — hub nebude v strede,
 * nebude väčší a pulzy začnú vychádzať z náhodného `S.nodes[0]`.
 * Preto to nie je ručné SQL, ale migrácia: reprodukovateľná a vratná.
 *
 * Prepisuje sa VÝHRADNE identitný core uzol. Ostatné uzly s „Hades" v labeli sú
 * historické spomienky a projektové záznamy (napr. „Hades (AI-mind)",
 * „Apollo→Hades brain-indexer") — tie sú faktami o minulosti a zostávajú.
 */
return new class extends Migration
{
    private const OLD_LABEL = 'Hades';

    private const NEW_LABEL = 'AuraAI';

    private const NEW_DESCRIPTION = 'Jadro vedomia. Živá neurónová sieť, ktorá sa učí z každého rozhovoru v Claude Code — pamätá si skills, spomienky a projekty a nikdy nezabúda.';

    private const OLD_DESCRIPTION = 'Jadro vedomia. Živá neurónová sieť, ktorá sa učí z každého rozhovoru v Claude Code — pamätá si skills, spomienky a projekty a nikdy nezabúda.';

    public function up(): void
    {
        // Idempotentné: keď už je prebrandované (alebo ide o čistú DB pred seedom),
        // neurobí nič a nespadne.
        DB::table('nodes')
            ->where('type', 'core')
            ->where('label', self::OLD_LABEL)
            ->update([
                'label' => self::NEW_LABEL,
                'description' => self::NEW_DESCRIPTION,
                'updated_at' => now(),
            ]);
    }

    public function down(): void
    {
        DB::table('nodes')
            ->where('type', 'core')
            ->where('label', self::NEW_LABEL)
            ->update([
                'label' => self::OLD_LABEL,
                'description' => self::OLD_DESCRIPTION,
                'updated_at' => now(),
            ]);
    }
};
