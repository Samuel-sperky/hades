<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Behy konzolových „agentov" mysle (vlna W0 — agent command centre).
 *
 * Jeden riadok = jedno spustenie príkazu z UI (obrazovka DASHBOARDS) cez
 * RunAgentJob. Nesie živý stav pre panel: progres, aktuálny krok, nazbieraný
 * log a štatistiky behu. Register agentov je statický (AgentRegistry), tu žije
 * len história behov — audit, nikdy nie zdroj pravdy o samotných agentoch.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('agent_runs', function (Blueprint $table): void {
            $table->id();
            // slug agenta z AgentRegistry (napr. 'mind-digest')
            $table->string('agent_key')->index();
            // queued | running | paused | done | failed
            $table->string('status', 12)->default('queued');
            $table->unsignedTinyInteger('progress')->default(0);
            // SK popis aktuálneho kroku pre panel
            $table->string('step')->nullable();
            // riadky výstupu príkazu (celý zachytený stdout)
            $table->longText('log')->nullable();
            // štruktúrované štatistiky behu (napr. exit_code, počet riadkov)
            $table->json('stats')->nullable();
            // SK správa pre používateľa (dôvod zlyhania / pozastavenia)
            $table->text('message')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('agent_runs');
    }
};
