<?php

namespace App\Services\Agents;

/**
 * Statický register konzolových „agentov" mysle — jediný zdroj pravdy pre
 * obrazovky DASHBOARDS (živé command centre) a CHART (rollout podľa autonómie).
 *
 * Register len POPISUJE príkazy (metadáta), nespúšťa ich — spustenie rieši
 * AgentController → RunAgentJob. Zahŕňa 17 class-based príkazov z
 * app/Console/Commands, 4 closure príkazy `aura:*` z routes/console.php a
 * placeholder rámec pre budúcich externých „workforce" agentov (nedá sa spustiť).
 *
 * Polia agenta:
 *   key         slug (napr. 'mind-digest')
 *   command     artisan príkaz (napr. 'mind:digest') alebo null pre placeholder
 *   label       SK názov do UI
 *   description SK popis (1 veta) čo agent robí
 *   category    maintenance | llm | ingest | workforce
 *   autonomy    manual | assisted | autonomous
 *   destructive nevratne maže/zlučuje dáta (true len pre tri nočné joby)
 *   schedule    SK popis frekvencie (z routes/console.php)
 *   placeholder true = koncept bez reálneho príkazu, nedá sa spustiť
 */
class AgentRegistry
{
    /**
     * @var list<array{
     *     key: string, command: ?string, label: string, description: string,
     *     category: string, autonomy: string, destructive: bool,
     *     schedule: string, placeholder: bool
     * }>
     */
    private const AGENTS = [
        // ---- ingest -------------------------------------------------------
        [
            'key' => 'mind-ingest',
            'command' => 'mind:ingest',
            'label' => 'Ingest transcriptov',
            'description' => 'Zapíše záznamy z Claude Code transcriptov do mozgu (bez modelu, čisto kódom).',
            'category' => 'ingest',
            'autonomy' => 'autonomous',
            'destructive' => false,
            'schedule' => 'Každých 10 min · nočný plný beh 03:35',
            'placeholder' => false,
        ],
        [
            'key' => 'mind-brain-sync',
            'command' => 'mind:brain-sync',
            'label' => 'Sync mozgov (.md)',
            'description' => 'Indexuje .md „mozgy" (skills/memory/externé) do siete ako origin=brain uzly.',
            'category' => 'ingest',
            'autonomy' => 'autonomous',
            'destructive' => false,
            'schedule' => 'Každých 10 min · nočný beh 03:25',
            'placeholder' => false,
        ],
        [
            'key' => 'mind-sync-memory',
            'command' => 'mind:sync-memory',
            'label' => 'Import Claude memory',
            'description' => 'Načíta Claude memory .md súbory naprieč projektmi ako memory uzly.',
            'category' => 'ingest',
            'autonomy' => 'autonomous',
            'destructive' => false,
            'schedule' => 'Denne 04:55',
            'placeholder' => false,
        ],
        [
            'key' => 'mind-seed-skills',
            'command' => 'mind:seed-skills',
            'label' => 'Seed skillov',
            'description' => 'Naseeduje skill uzly z playbookov v skills/<oblast>/*.md do mozgu.',
            'category' => 'ingest',
            'autonomy' => 'manual',
            'destructive' => false,
            'schedule' => 'Na požiadanie',
            'placeholder' => false,
        ],
        [
            'key' => 'sperky-aggregate',
            'command' => 'sperky:aggregate',
            'label' => 'Súhrn objednávok e-shopu',
            'description' => 'Spočíta mesačný súhrn objednávok z e-shopu a zapíše ho do vedomia (idempotentne).',
            'category' => 'ingest',
            'autonomy' => 'manual',
            'destructive' => false,
            'schedule' => 'Na požiadanie',
            'placeholder' => false,
        ],

        // ---- llm ----------------------------------------------------------
        [
            'key' => 'aura-embed',
            'command' => 'aura:embed',
            'label' => 'Embeddingy uzlov',
            'description' => 'Prepočíta embeddingy uzlov (bge-m3) do nodes.embedding — idempotentne.',
            'category' => 'llm',
            'autonomy' => 'autonomous',
            'destructive' => false,
            'schedule' => 'Denne 04:35',
            'placeholder' => false,
        ],

        // ---- maintenance --------------------------------------------------
        [
            'key' => 'mind-reorganize',
            'command' => 'mind:reorganize',
            'label' => 'Reorganizácia siete',
            'description' => 'Preusporiada uzly mozgu: playbooky do Knižnice, záznamy podľa projektu, súhrny a nezaradené.',
            'category' => 'maintenance',
            'autonomy' => 'autonomous',
            'destructive' => false,
            'schedule' => 'Denne 03:50',
            'placeholder' => false,
        ],
        [
            'key' => 'mind-rewire',
            'command' => 'mind:rewire',
            'label' => 'Prepojenie synapsií',
            'description' => 'Backfill: doplní chýbajúce similarity, skill_mention a cross-domain mosty medzi príbuznými uzlami.',
            'category' => 'maintenance',
            'autonomy' => 'manual',
            'destructive' => false,
            'schedule' => 'Na požiadanie (v noci beží aura:rewire)',
            'placeholder' => false,
        ],
        [
            'key' => 'aura-rewire',
            'command' => 'aura:rewire',
            'label' => 'Prepojenie synapsií (triedené)',
            'description' => 'Backfill similarity/skill_mention/mostov rozdelený na triedy so stropom času a veľkosti.',
            'category' => 'maintenance',
            'autonomy' => 'autonomous',
            'destructive' => false,
            'schedule' => 'Denne 04:05',
            'placeholder' => false,
        ],
        [
            'key' => 'mind-decay',
            'command' => 'mind:decay',
            'label' => 'Zabúdanie (decay)',
            'description' => 'Oslabí neaktívne uzly (>14 dní) a staré automatické synapsie (>30 dní).',
            'category' => 'maintenance',
            'autonomy' => 'autonomous',
            'destructive' => false,
            'schedule' => 'Denne 04:20',
            'placeholder' => false,
        ],
        [
            'key' => 'mind-digest',
            'command' => 'mind:digest',
            'label' => 'Týždenný súhrn',
            'description' => 'Vytvorí týždenný súhrnný uzol mozgu (kódová agregácia, bez modelu).',
            'category' => 'maintenance',
            'autonomy' => 'autonomous',
            'destructive' => false,
            'schedule' => 'Nedeľa 04:00',
            'placeholder' => false,
        ],
        [
            'key' => 'mind-rollup',
            'command' => 'mind:rollup',
            'label' => 'Projektový roll-up',
            'description' => 'Zapíše živý súhrn každého projektu do summaries/projects/<slug>.md.',
            'category' => 'maintenance',
            'autonomy' => 'autonomous',
            'destructive' => false,
            'schedule' => 'Nedeľa 05:15',
            'placeholder' => false,
        ],
        [
            'key' => 'mind-archive-old',
            'command' => 'mind:archive-old',
            'label' => 'Archivácia starých záznamov',
            'description' => 'Zbalí session záznamy staršie ako 90 dní do mesačných archívnych uzlov.',
            'category' => 'maintenance',
            'autonomy' => 'autonomous',
            'destructive' => false,
            'schedule' => '1. v mesiaci 04:30 (len s prepínačom)',
            'placeholder' => false,
        ],
        [
            'key' => 'mind-export-memory',
            'command' => 'mind:export-memory',
            'label' => 'Export do Claude memory',
            'description' => 'Exportuje jadro + projekty + silné fakty (max 25) do Claude memory (/memory-rw/hades).',
            'category' => 'maintenance',
            'autonomy' => 'autonomous',
            'destructive' => false,
            'schedule' => 'Denne 05:05',
            'placeholder' => false,
        ],
        [
            'key' => 'aura-backup',
            'command' => 'aura:backup',
            'label' => 'Záloha databázy',
            'description' => 'Dump databázy vedomia do backups/ + rotácia automatických dumpov.',
            'category' => 'maintenance',
            'autonomy' => 'autonomous',
            'destructive' => false,
            'schedule' => 'Denne 03:00',
            'placeholder' => false,
        ],
        [
            'key' => 'aura-sync-runs-prune',
            'command' => 'aura:sync-runs-prune',
            'label' => 'Rotácia audit logu',
            'description' => 'Rotácia sync_runs: staré behy podľa veku; historické no-op behy len s --purge-noop.',
            'category' => 'maintenance',
            'autonomy' => 'autonomous',
            'destructive' => false,
            'schedule' => 'Denne 05:30',
            'placeholder' => false,
        ],
        [
            'key' => 'aura-dry-run',
            'command' => 'aura:dry-run',
            'label' => 'Dry-run deštruktívnych jobov',
            'description' => 'Ukáže, čo BY deštruktívne joby zlúčili/zmazali (dvojitou metrikou). Nič nemení.',
            'category' => 'maintenance',
            'autonomy' => 'manual',
            'destructive' => false,
            'schedule' => 'Na požiadanie',
            'placeholder' => false,
        ],
        [
            'key' => 'aura-calibrate',
            'command' => 'aura:calibrate',
            'label' => 'Kalibrácia prahov',
            'description' => 'Sweep prahov deštruktívnych jobov s rozdelením skóre a značkovaním rizikových párov. Nič nemení.',
            'category' => 'maintenance',
            'autonomy' => 'manual',
            'destructive' => false,
            'schedule' => 'Na požiadanie',
            'placeholder' => false,
        ],

        // ---- maintenance / DEŠTRUKTÍVNE (za prepínačom) -------------------
        [
            'key' => 'mind-cleanup-edges',
            'command' => 'mind:cleanup-edges',
            'label' => 'Čistenie hrán',
            'description' => 'Zmaže zabudnuté auto synapsie (similarity/co-aktivácia, váha < 1, staršie ako 90 dní).',
            'category' => 'maintenance',
            'autonomy' => 'assisted',
            'destructive' => true,
            'schedule' => 'Denne 04:30 (len s prepínačom)',
            'placeholder' => false,
        ],
        [
            'key' => 'mind-prune-coactivation',
            'command' => 'mind:prune-coactivation',
            'label' => 'Prerezanie co-aktivácií',
            'description' => 'Prereže koincidenčné jednorazové co-aktivačné synapsie s podobnosťou koncov pod prahom.',
            'category' => 'maintenance',
            'autonomy' => 'assisted',
            'destructive' => true,
            'schedule' => 'Denne 04:35 (len s prepínačom)',
            'placeholder' => false,
        ],
        [
            'key' => 'mind-automerge',
            'command' => 'mind:automerge',
            'label' => 'Automatické zlúčenie',
            'description' => 'Automaticky zlúči takmer identické uzly (skilly/fakty), nikdy nie session záznamy.',
            'category' => 'maintenance',
            'autonomy' => 'assisted',
            'destructive' => true,
            'schedule' => 'Denne 04:45 (len s prepínačom)',
            'placeholder' => false,
        ],

        // ---- workforce (placeholder rámec — NEDAJÚ sa spustiť) ------------
        [
            'key' => 'workforce-research',
            'command' => null,
            'label' => 'Externý výskumník (koncept)',
            'description' => 'Placeholder pre budúcich externých „workforce" agentov mimo mysle — zatiaľ sa nedá spustiť.',
            'category' => 'workforce',
            'autonomy' => 'manual',
            'destructive' => false,
            'schedule' => '—',
            'placeholder' => true,
        ],
        [
            'key' => 'workforce-content',
            'command' => null,
            'label' => 'Obsahový agent (koncept)',
            'description' => 'Placeholder rámec pre externých obsahových agentov — koncept bez reálneho príkazu.',
            'category' => 'workforce',
            'autonomy' => 'manual',
            'destructive' => false,
            'schedule' => '—',
            'placeholder' => true,
        ],
    ];

    /**
     * Všetci agenti (vrátane placeholderov).
     *
     * @return list<array<string, mixed>>
     */
    public static function all(): array
    {
        return self::AGENTS;
    }

    /**
     * Nájde agenta podľa slugu; null ak neexistuje.
     *
     * @return array<string, mixed>|null
     */
    public static function find(string $key): ?array
    {
        foreach (self::AGENTS as $agent) {
            if ($agent['key'] === $key) {
                return $agent;
            }
        }

        return null;
    }

    /**
     * Agenti, ktorých sa dá reálne spustiť (nie placeholder).
     *
     * @return list<array<string, mixed>>
     */
    public static function runnable(): array
    {
        return array_values(array_filter(
            self::AGENTS,
            fn (array $agent): bool => $agent['placeholder'] === false,
        ));
    }
}
