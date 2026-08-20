<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Front odložených zápisov — čo agent chcel zapísať v behu, pri ktorom nikto nebol.
 *
 * Prečo to nejde bez vlastnej tabuľky: `isWrite()` v tejto konzole neznamená
 * „mení dáta", ale „beh sa ZAPARKUJE a čaká na človeka" (kontrakt `ConsoleTool`).
 * V programovom behu (skript, MCP `console_run`, nočný rozvrh) tam nikto nie je,
 * takže parkovanie nie je pauza, ale trvalé zablokovanie vlákna — a preto z headless
 * sady zápisové tooly celé vypadli. Dôsledok bol, že nočný rozvrh nedokázal
 * navrhnúť zmenu, len napísať report.
 *
 * Tento riadok je tretie chovanie: NEVYKONÁ a NEZAPARKUJE, ale ZAZNAMENÁ. Ťah
 * skončí normálne rámcom `end`, vlákno zostane použiteľné pre ďalší beh a človek
 * si zajtra prejde frontu (`hades pending`).
 *
 * Prečo to nie je ďalší stav v `console_tool_calls`: `pending` tool call tam
 * ZNAMENÁ zaparkované vlákno — `ConsoleThread::pendingToolCall()` podľa neho
 * odmieta ďalšiu správu a `AgentRunner::resume()` naň nadväzuje smyčku.
 * Odložený návrh je presne to opačné: vlákno je voľné a ťah je uzavretý. Keby
 * sedeli v tej istej tabuľke, jeden nočný beh s tromi navrhnutými zápismi by
 * zablokoval vlákno tak, že by doň nešlo poslať ani ďalšiu otázku.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('console_write_proposals', function (Blueprint $table) {
            $table->id();
            // uuid je verejný identifikátor návrhu: pod ním ho vypisuje `hades
            // pending` a pod ním sa rozhoduje. `id` v adrese by prezrádzalo,
            // koľko zápisov si už AI navrhla.
            $table->uuid('uuid')->unique();
            // Vlákno je povinné a je to zámer: návrh bez vlákna sa nedá prečítať
            // v kontexte („čo model v tom behu robil a prečo to chcel"), takže by
            // sa o ňom nedalo rozhodnúť. So vláknom aj zomrie.
            $table->foreignId('thread_id')->constrained('console_threads')->cascadeOnDelete();
            $table->string('name');
            $table->json('arguments')->nullable();
            // Náhľad sa počíta pri ZÁZNAME, nie pri rozhodovaní: `write_file` diff
            // proti stavu súboru vtedy, `edit_file` zhodu vzoru vtedy. O týždeň
            // môže byť súbor iný a diff by sa už nemal z čoho poskladať —
            // a človek by rozhodoval o niečom, čo nevidí.
            $table->longText('preview')->nullable();
            // Enum, nie string: sada stavov je zavretá a preklep má odmietnuť DB,
            // nie sa objaviť ako večne otvorený návrh, ktorý žiadny výpis nenájde.
            // `failed` tu ZÁMERNE nie je — zlyhanie vykonania je výsledok
            // rozhodnutia (text v `result`), nie iné rozhodnutie. Keby bolo
            // stavom, `approve` by sa dalo zopakovať nad polovične vykonaným
            // zápisom, a to je pri `write_file` presne tá škoda, ktorej sa front
            // vyhýba.
            $table->enum('status', ['pending', 'approved', 'denied'])->default('pending');
            // Čo vrátil tool po povolení (alebo prečo nič) — jediná stopa po tom,
            // ako sa zápis nakoniec skončil.
            $table->longText('result')->nullable();
            $table->timestamp('decided_at')->nullable();
            $table->timestamps();

            // Dva indexy, dve otázky: „čo čaká na tomto vlákne" (výpis vlákna)
            // a „čo čaká celkovo" (`hades pending` a strop na počet otvorených).
            $table->index(['thread_id', 'status']);
            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('console_write_proposals');
    }
};
