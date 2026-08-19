<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Vlákna konzoly vedomia — perzistentný stav agentového behu.
 *
 * Prečo to musí byť v DB a nie v localStorage ako doterajší chat: konzola beží
 * dvojfázovo. Keď agent chce zapisovať (upraviť uzol, prepísať súbor), beh sa
 * NEZASTAVÍ so držaným HTTP spojením a nečaká na rozhodnutie — turn skončí so
 * stavom `awaiting_permission`, klient pošle rozhodnutie a beh sa obnoví z
 * uloženého stavu. Blokujúce čakanie by držalo jedného z ôsmich PHP workerov na
 * neurčito a pri dvoch-troch súbežných vláknach by appka prestala odpovedať.
 *
 * Dôsledok, ktorý sa oplatí povedať nahlas: `console_messages` je jediný zdroj
 * pravdy o konverzácii. Pri obnove sa história skladá odtiaľ, nie z toho, čo
 * poslal prehliadač — inak by si klient vedel prepísať vlastnú minulosť a
 * podstrčiť modelu tool výsledok, ktorý nikdy nenastal.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('console_threads', function (Blueprint $table) {
            $table->id();
            // uuid nesie URL (/console/<uuid>) — id v adrese by prezrádzalo počet vlákien
            $table->uuid('uuid')->unique();
            $table->string('title')->nullable();
            // ktorý poskytovateľ a model vlákno viedol; história si pamätá aj prepnutie
            $table->string('provider')->default('ollama');
            $table->string('model')->nullable();
            // „auto-accept" na sedenie — povolí zápisové tooly bez pýtania sa
            $table->boolean('auto_accept')->default(false);
            $table->timestamp('last_message_at')->nullable();
            $table->timestamps();

            $table->index('last_message_at');
        });

        Schema::create('console_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('thread_id')->constrained('console_threads')->cascadeOnDelete();
            // system sem patrí tiež: keď sa zmení smernica, staré vlákno musí
            // zostať čitateľné s tou, s ktorou reálne bežalo
            $table->enum('role', ['system', 'user', 'assistant', 'tool']);
            $table->longText('content')->nullable();
            $table->string('model')->nullable();
            $table->string('stop_reason')->nullable();
            $table->unsignedInteger('tokens_in')->nullable();
            $table->unsignedInteger('tokens_out')->nullable();
            // tok/s meriame na CPU inferencii — bez toho sa nedá porovnať model s modelom
            $table->unsignedInteger('duration_ms')->nullable();
            $table->timestamps();

            $table->index(['thread_id', 'id']);
        });

        Schema::create('console_tool_calls', function (Blueprint $table) {
            $table->id();
            $table->foreignId('thread_id')->constrained('console_threads')->cascadeOnDelete();
            // správa asistenta, ktorá tool vyžiadala; null pri obnove starého stavu
            $table->foreignId('message_id')->nullable()->constrained('console_messages')->nullOnDelete();
            // id, ktorým tool call pomenoval model — pod ním sa vracia výsledok
            $table->string('call_id')->nullable();
            $table->string('name');
            $table->json('arguments')->nullable();
            // pending = čaká na rozhodnutie človeka; denied je koncový stav, nie chyba
            $table->enum('status', ['pending', 'running', 'done', 'denied', 'failed'])->default('pending');
            $table->longText('result')->nullable();
            $table->text('error')->nullable();
            // náhľad zmeny (diff) sa počíta pred vykonaním — po zápise už nie je z čoho
            $table->longText('preview')->nullable();
            $table->timestamp('decided_at')->nullable();
            $table->unsignedInteger('duration_ms')->nullable();
            $table->timestamps();

            $table->index(['thread_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('console_tool_calls');
        Schema::dropIfExists('console_messages');
        Schema::dropIfExists('console_threads');
    }
};
