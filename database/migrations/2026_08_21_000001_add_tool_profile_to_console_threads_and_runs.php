<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Profil nástrojov behu — s čím ten ťah bežal.
 *
 * `nullable` a NIE `default('full')`: `null` znamená „beh z čias pred profilmi"
 * a to je pravdivá informácia, kým `'full'` by o starých behoch tvrdil niečo, čo
 * nikto nezaznamenal.
 *
 * `string(32)`, nie `enum` — z toho istého dôvodu ako `runs.source`: enum by si
 * vyžiadal migráciu na každý nový profil.
 *
 * Profil žije na DVOCH miestach a je to zámer: `console_threads.tool_profile`
 * je zdroj pravdy pre OBNOVU zaparkovaného behu (aby sa sada toolov nedala
 * vymeniť medzi vyžiadaním povolenia a jeho vykonaním — profil sa číta zo
 * servera, nie z klienta), `runs.tool_profile` je to, čo log behov ukáže človeku
 * aj AI.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('console_threads', function (Blueprint $table): void {
            $table->string('tool_profile', 32)->nullable()->after('model');
        });

        Schema::table('runs', function (Blueprint $table): void {
            $table->string('tool_profile', 32)->nullable()->after('model');
        });
    }

    public function down(): void
    {
        Schema::table('console_threads', function (Blueprint $table): void {
            $table->dropColumn('tool_profile');
        });

        Schema::table('runs', function (Blueprint $table): void {
            $table->dropColumn('tool_profile');
        });
    }
};
