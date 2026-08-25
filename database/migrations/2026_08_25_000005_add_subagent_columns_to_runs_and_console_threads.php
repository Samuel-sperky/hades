<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Podagenti — čo z nich musí byť v schéme.
 *
 * `runs.parent_run_id` už existuje (migrácia `2026_08_25_000004_*`) a tu sa
 * NEDUPLIKUJE. Tri stĺpce, ktoré k nemu chýbajú:
 *
 * ## `runs.parent_call_id`
 *
 * `spawn_agent` call, ktorý toto dieťa vyžiadal. Robí z pokračovania rodiča
 * vyhľadanie podľa kľúča namiesto úsudku „jediný blokovaný call vo vlákne" — ten
 * úsudok dnes platí (cally sa vykonávajú po jednom), ale platí **náhodou**. Je to
 * zároveň kľúč, na ktorom stojí idempotencia toolu: „pre tento call už dieťa
 * existuje" je jediné, čo bráni druhému podbehu a obídeniu brány zápisov.
 *
 * ## `console_threads.parent_thread_id`
 *
 * Vlákno podagenta. Non-null znamená „nie je to konverzácia": nezobrazuje sa
 * v zozname vlákien a **neprijíma nové správy** (rámec `agent_wait` posiela jeho
 * uuid do prehliadača, takže klient ho pozná — bez guardu by doň vedel písať).
 * `POST /api/console/decide` naň naopak povolené zostáva; to je celá brána.
 *
 * ## `console_threads.max_steps`
 *
 * Strop kôl TOHTO vlákna. `null` = strop z configu (dnešné chovanie, všetky
 * existujúce vlákna). Je to na VLÁKNE a nie v `$options` behu, aby ho `/decide`
 * čítalo zo servera — presne z toho istého dôvodu ako `tool_profile`: inak by si
 * klient vedel strop vymeniť medzi vyžiadaním povolenia a jeho vykonaním.
 *
 * ## Prečo BEZ cudzích kľúčov
 *
 * Tá istá úvaha, akou to zdôvodnila migrácia `parent_run_id`, a platí pre oba nové
 * ukazovatele:
 *
 *  - `cascadeOnDelete` na `parent_call_id` by zmazaním vlákna (a s ním jeho tool
 *    callov) vzalo aj riadky v `runs`, teda presne tú stratu, ktorú naprávala
 *    `2026_08_20_000001_keep_runs_when_a_thread_is_deleted`;
 *  - `nullOnDelete` by prepísalo to jediné, čo tie stĺpce hovoria: z podbehu by
 *    urobilo beh bez rodiča a z vlákna podagenta **konverzáciu, ktorá prijíma
 *    správy**. Fail-open v mieste, kde je celá brána.
 *
 * Visiaci ukazovateľ je čitateľný stav („rodič už neexistuje"), rovnako ako dnešné
 * `thread = null` v `mind_runs`. Guard na vlákno podagenta zostáva platný aj po
 * zmazaní rodiča, pretože sa pýta „je to non-null?", nie „existuje rodič?".
 *
 * `runs.source` dostane hodnotu `'agent'` — migráciu netreba, `source` je
 * `string(32)` presne preto (enum by si vyžiadal migráciu na každý nový zdroj).
 * `console_tool_calls.status` je enum a **nemení sa**: `spawn_agent` call rodiča
 * zostáva `pending` a nedostal nový stav `blocked`, ktorý by znamenal migráciu
 * enumu na hot tabuľke a novú vetvu v každom `match`i, čo status čítá.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('runs', function (Blueprint $table): void {
            $table->unsignedBigInteger('parent_call_id')->nullable()->after('parent_run_id');

            // Index ÁNO: dopyt „dieťa tohto callu" (`WHERE parent_call_id = ?`) beží
            // pri KAŽDOM vykonaní `spawn_agent` — je to kontrola idempotencie, teda
            // najhorúcejšia cesta celej tejto funkcie.
            $table->index('parent_call_id');
        });

        Schema::table('console_threads', function (Blueprint $table): void {
            $table->unsignedBigInteger('parent_thread_id')->nullable()->after('uuid');

            // `unsignedTinyInteger`: strop je 1-8 (`SpawnAgentTool::HARD_MAX_STEPS`),
            // takže jeden bajt je viac než dosť a schéma tým hovorí, že sem nepatrí
            // číslo, ktoré by beh nikdy nedobehol.
            $table->unsignedTinyInteger('max_steps')->nullable()->after('tool_profile');

            // Index na „deti tohto vlákna". Zoznam vlákien filtruje `IS NULL`, čo
            // index nepotrebuje, ale strom podagentov v detaile behu áno.
            $table->index('parent_thread_id');
        });
    }

    public function down(): void
    {
        // Index sa musí zahodiť PRED stĺpcom a v samostatnom `Schema::table`:
        // Laravel 13 pustí na sqlite natívne `ALTER TABLE DROP COLUMN` a to
        // indexovaný stĺpec odmietne. Dva bloky, aby sa poradie nedalo
        // preusporiadať — tú istú pascu popisuje migrácia `parent_run_id`.
        Schema::table('runs', function (Blueprint $table): void {
            $table->dropIndex(['parent_call_id']);
        });

        Schema::table('runs', function (Blueprint $table): void {
            $table->dropColumn('parent_call_id');
        });

        Schema::table('console_threads', function (Blueprint $table): void {
            $table->dropIndex(['parent_thread_id']);
        });

        Schema::table('console_threads', function (Blueprint $table): void {
            $table->dropColumn(['parent_thread_id', 'max_steps']);
        });
    }
};
