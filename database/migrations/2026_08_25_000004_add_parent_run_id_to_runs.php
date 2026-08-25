<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Strom podbehov — `runs.parent_run_id`.
 *
 * Orchestrátor spustí podagenta (`spawn_agent`) a ten beží ako vlastný ťah:
 * vlastné kroky, vlastné tokeny, vlastná dvojfázová brána. Podbeh preto nie je
 * riadok v rodičovi ani stĺpec v ňom, je to **beh s ukazovateľom na rodiča** —
 * a log behov ho vykreslí ako strom nad tou istou obrazovkou Runy.
 *
 * `nullable` a **NIE `default`** — presne z dôvodu, ktorý pomenovala migrácia
 * `2026_08_21_000001_add_tool_profile_*`: `null` znamená „beh, ktorý nikto
 * nespustil, začal ho človek", a to je pravdivá informácia o každom existujúcom
 * riadku. Akákoľvek default hodnota by musela byť číslo, a `0` nie je beh —
 * o starých behoch by tvrdila, že mali rodiča, ktorého nikto nezaznamenal.
 * Backfill preto nie je (na rozdiel od `branch_id`, kde sme pravdu poznali).
 *
 * **BEZ cudzieho kľúča**, a ani jedna z jeho dvoch podôb tu nie je správna:
 *  - `cascadeOnDelete` by zmazaním jedného riadku zmazal celý podstrom logu —
 *    to je presne tá strata, ktorú naprávala
 *    `2026_08_20_000001_keep_runs_when_a_thread_is_deleted`;
 *  - `nullOnDelete` by z podbehu ticho urobil beh spustený človekom, teda by
 *    prepísal to jediné, čo tento stĺpec hovorí.
 * Visiaci ukazovateľ je čitateľný stav („rodič už neexistuje"), rovnako ako
 * dnešné `thread = null` v `mind_runs`.
 *
 * Podbeh dedí `thread_id` a `branch_id` rodiča: hovorí do tej istej konverzácie
 * a jeho zaparkovaný zápis čaká na toho istého človeka. Rozsah id zostáva
 * presný — beh vo vlákne je jeden naraz, takže rodič je počas podbehu pozastavený
 * a nezapisuje vlastné správy. Túto podmienku musí držať `spawn_agent`, nie
 * schéma: keby rodič a podagent písali súbežne, oba rozsahy sa prekryjú.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('runs', function (Blueprint $table) {
            $table->unsignedBigInteger('parent_run_id')->nullable()->after('thread_id');

            // Index ÁNO, na rozdiel od `runs.branch_id` z predchádzajúcej migrácie.
            // Dopyt „deti behu X" (`WHERE parent_run_id = ?`) beží pri každom
            // otvorení detailu a pri kreslení stromu, a `runs` je jediná tabuľka
            // v tomto šprinte, ktorá rastie s každou interakciou — takže je to
            // jediné miesto, kde index zaplatí sám seba.
            $table->index('parent_run_id');
        });
    }

    public function down(): void
    {
        // Index sa musí zahodiť pred stĺpcom: Laravel 13 pustí na sqlite natívne
        // `ALTER TABLE DROP COLUMN` a to indexovaný stĺpec odmietne. Dva
        // samostatné `Schema::table`, aby sa poradie nedalo preusporiadať.
        Schema::table('runs', function (Blueprint $table) {
            $table->dropIndex(['parent_run_id']);
        });

        Schema::table('runs', function (Blueprint $table) {
            $table->dropColumn('parent_run_id');
        });
    }
};
