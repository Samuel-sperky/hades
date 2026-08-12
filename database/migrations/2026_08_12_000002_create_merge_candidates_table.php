<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A6 — fronta návrhov na zlúčenie.
 *
 * Zlučovanie prestáva byť automatické. Dry-run z 2026-07-31 ukázal, že najvyššie
 * skórujúce páry (0,8994) neboli duplikáty, ale sesterské projekty, a živý beh
 * to potvrdil: 26.7. automerge nevratne pohltil „Súhrn týždňa 30/2026" do
 * „Súhrn týždňa 29/2026" pri skóre 0,9258. Dva rôzne týždne.
 *
 * Detekcia má hodnotu, samotné zlúčenie je to nespoľahlivé. Od teraz teda
 * mind:automerge aj mind_learn iba plnia túto tabuľku a posledné slovo má človek.
 *
 * Pár sa normalizuje na (menšie id, väčšie id), aby ten istý návrh nevznikol
 * dvakrát z oboch strán.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('merge_candidates', function (Blueprint $table) {
            $table->id();
            $table->foreignId('node_a_id')->constrained('nodes')->cascadeOnDelete();
            $table->foreignId('node_b_id')->constrained('nodes')->cascadeOnDelete();
            $table->float('score')->default(0);

            // cross_type_slug = rovnaký slug, iný type (findByLabel ich nikdy
            // nestretol, lebo zhodu filtruje typom — 9 z 10 nájdených duplicít)
            // similar_label   = podobnosť v pásme review (85–95 %)
            // cosine          = návrh z nočného mind:automerge
            $table->string('reason', 32)->index();

            $table->string('status', 12)->default('pending')->index();
            $table->timestamp('resolved_at')->nullable();
            $table->timestamps();

            $table->unique(['node_a_id', 'node_b_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('merge_candidates');
    }
};
