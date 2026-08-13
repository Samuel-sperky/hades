<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Doplní FULLTEXT index, ktorý migrácia A10 ticho preskočila.
 *
 * Podmienka znela `DB::getDriverName() === 'mysql'`, lenže Laravel pre MariaDB
 * vracia `mariadb`. Migrácia ohlásila DONE za 38 ms a index nevznikol — chyba
 * sa prejavila až pri hľadaní v sesterskej appke, kde tá istá podmienka spôsobila
 * „Can't find FULLTEXT index matching the column list“.
 *
 * Idempotentná: kde index už je, neurobí nič.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! in_array(DB::getDriverName(), ['mysql', 'mariadb'], true)) {
            return;
        }

        if (DB::select("SHOW INDEX FROM `nodes` WHERE Key_name = 'nodes_fulltext'") !== []) {
            return;
        }

        Schema::table('nodes', function (Blueprint $table) {
            $table->fullText(['label', 'description'], 'nodes_fulltext');
        });
    }

    public function down(): void
    {
        if (! in_array(DB::getDriverName(), ['mysql', 'mariadb'], true)) {
            return;
        }

        Schema::table('nodes', fn (Blueprint $table) => $table->dropFullText('nodes_fulltext'));
    }
};
