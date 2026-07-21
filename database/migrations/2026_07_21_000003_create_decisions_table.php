<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('decisions', function (Blueprint $table) {
            $table->id();

            // voliteľná väzba na uzol, ktorého sa rozhodnutie týka
            $table->foreignId('node_id')->nullable()->constrained('nodes')->nullOnDelete();
            // oblasť mozgu (filter časovej osi podľa oblasti)
            $table->foreignId('area_id')->nullable()->constrained('areas')->nullOnDelete();

            $table->date('decided_on')->index();
            $table->text('text');
            $table->text('reason')->nullable();

            // 'session' = ručne / mind_decision (DB-first),
            // 'brain'   = indexované z .md pri brain-write ON
            $table->string('origin', 10)->default('session')->index();

            $table->string('source_file')->nullable();
            $table->unsignedInteger('source_line')->nullable();

            // sha256 obsahu — UNIQUE (data-safety poučenie z Apolla); NULL pre
            // ručné session rozhodnutia (MariaDB dovolí viac NULL v UNIQUE indexe).
            $table->char('content_hash', 64)->nullable()->unique();

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('decisions');
    }
};
