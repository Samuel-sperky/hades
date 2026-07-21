<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('nodes', function (Blueprint $table) {
            // 'session' = uzol z mind_learn / sessions (DB-first),
            // 'brain'   = uzol indexovaný z ľudsky písaného .md (markdown-as-master)
            $table->string('origin', 10)->default('session')->index()->after('source');

            // istota poznatku: overene | hypoteza | pasca | null (bez).
            // string(10), nie DB enum — konzistentné s kind/relation (§4.10).
            $table->string('certainty', 10)->nullable()->after('description');

            // verify/review workflow — fronta na kontrolu + čas overenia
            $table->boolean('needs_review')->default(false)->index()->after('certainty');
            $table->timestamp('verified_at')->nullable()->after('needs_review');

            // pôvod v .md súbore (pre brain uzly) — zdroj pravdy pri hybrid CRUD
            $table->string('source_file')->nullable()->after('verified_at');
            $table->unsignedInteger('source_line')->nullable()->after('source_file');

            // sha256 obsahu — dedupe + idempotentný sync.
            // UNIQUE (data-safety poučenie z Apolla); NULL povolený pre session uzly
            // (MariaDB dovolí viac NULL v UNIQUE indexe).
            $table->char('content_hash', 64)->nullable()->unique()->after('source_line');

            // heatmapa aktivity / kumulatívny rast čítajú created_at → vlastný index
            $table->index('created_at');
        });
    }

    public function down(): void
    {
        Schema::table('nodes', function (Blueprint $table) {
            $table->dropUnique(['content_hash']);
            $table->dropIndex(['origin']);
            $table->dropIndex(['needs_review']);
            $table->dropIndex(['created_at']);
            $table->dropColumn([
                'origin', 'certainty', 'needs_review', 'verified_at',
                'source_file', 'source_line', 'content_hash',
            ]);
        });
    }
};
