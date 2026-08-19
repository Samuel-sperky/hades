<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * HTML reporty, ktoré napísal model cez tool `write_report`.
 *
 * Prečo vôbec riadok v DB, keď obsah žije ako súbor v `storage/app/reports`:
 * report sa servuje autentizovanou routou pod `uuid` a bez tabuľky by tá routa
 * musela veriť tomu, čo príde v URL, a skladať z toho cestu na disku. To je
 * traversal, nie routing. Tabuľka je zoznam toho, čo smie existovať; súbor je
 * len telo. Zároveň z nej vieme, čo je najstaršie, a preto sa dá držať strop
 * `hades.console.reports.keep` — inak priečinok rastie bez konca.
 *
 * `thread_id` tu ZÁMERNE nie je. Tooly vyrába `ToolRegistry` z kontejnera,
 * teda bez kontextu vlákna — `write_report` o vlákne nevie a nemá
 * odkiaľ vedieť. Stĺpec by preto zostal navždy `null` a lákal by na dopyty,
 * ktoré nikdy nič nevrátia. Keď raz bude potreba viazať report na vlákno, musí
 * to prísť spolu so zmenou kontraktu toolov, nie samo v migrácii.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('console_reports', function (Blueprint $table) {
            $table->id();
            // uuid nesie URL (/console/reports/<uuid>) aj názov súboru na disku;
            // id v adrese by prezrádzalo, koľko reportov už model napísal
            $table->uuid('uuid')->unique();
            $table->string('title');
            // v čom to model napísal — `html` obchádza markdown renderer, takže
            // pri neskoršom audite treba vedieť, ktorý vstup to bol
            $table->enum('format', ['markdown', 'html']);
            // veľkosť VÝSLEDNEJ stránky, nie vstupu: to je to, čo routa pošle
            $table->unsignedInteger('bytes');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('console_reports');
    }
};
