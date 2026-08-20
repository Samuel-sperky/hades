<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * `runs.thread_id`: `cascadeOnDelete` → `nullOnDelete`.
 *
 * Pôvodná migrácia mala kaskádu a review 20. 8. 2026 na tom ukázal, že jeden klik
 * „zmazať vlákno" v paneli konzoly zmazal **celú históriu behov** toho vlákna.
 * Log, ktorý sa dá takto stratiť, nespĺňa to, čo o ňom kontrakt tvrdí („každý beh
 * konzoly je perzistovaný"), a popis MCP toolu `mind_runs` navyše modelu sľuboval
 * stav, ktorý schéma vylučovala: „no `thread` means the run outlived its thread".
 *
 * Pôvodná migrácia je opravená TIEŽ — nie namiesto tejto. Dôvod: čerstvá databáza
 * (testy na sqlite) musí mať to isté chovanie ako živá, inak by test „beh prežije
 * zmazanie vlákna" prešiel na jednej a padol na druhej. Táto migrácia dorovná
 * databázy, ktoré pôvodnú verziu už spustili.
 *
 * Na SQLite sa preskakuje: `dropForeign` tam nie je podporené a čerstvá schéma už
 * `nullOnDelete` má z opravenej pôvodnej migrácie.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::connection()->getDriverName() === 'sqlite') {
            return;
        }

        Schema::table('runs', function (Blueprint $table) {
            $table->dropForeign(['thread_id']);
            $table->foreign('thread_id')->references('id')->on('console_threads')->nullOnDelete();
        });
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'sqlite') {
            return;
        }

        Schema::table('runs', function (Blueprint $table) {
            $table->dropForeign(['thread_id']);
            $table->foreign('thread_id')->references('id')->on('console_threads')->cascadeOnDelete();
        });
    }
};
