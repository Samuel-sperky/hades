<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A10 — FULLTEXT index nad label + description.
 *
 * searchNodes() hľadá cez `LIKE '%koreň%'`. Vedúci zástupný znak znemožňuje
 * použiť akýkoľvek B-tree index, takže každý recall prejde celú tabuľku:
 * EXPLAIN hlási `type: ALL`, 2 592 riadkov. Namerané 206–333 ms na recall pri
 * 2 590 uzloch — a sieť narástla ×3,9 za dva týždne, takže to porastie lineárne.
 *
 * Index je aditívny a sám osebe nič nemení: rýchlu cestu treba zapnúť cez
 * `HADES_RECALL_FULLTEXT=true`. Default je vypnutý zámerne — MATCH ... AGAINST
 * matchuje od začiatku slova, kým LIKE '%x%' aj uprostred, takže zapnutie je
 * rozhodnutie o pokrytí, nie iba o rýchlosti.
 *
 * SQLite (testy) FULLTEXT v tomto tvare nepozná, preto je index len pre MySQL/MariaDB.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Laravel hlási pre MariaDB driver `mariadb`, nie `mysql` — podmienka
        // len na 'mysql' index ticho preskočí (viď 2026_08_12_000005).
        if (! in_array(DB::getDriverName(), ['mysql', 'mariadb'], true)) {
            return;
        }

        Schema::table('nodes', function (Blueprint $table) {
            $table->fullText(['label', 'description'], 'nodes_fulltext');
        });
    }

    public function down(): void
    {
        // Laravel hlási pre MariaDB driver `mariadb`, nie `mysql` — podmienka
        // len na 'mysql' index ticho preskočí (viď 2026_08_12_000005).
        if (! in_array(DB::getDriverName(), ['mysql', 'mariadb'], true)) {
            return;
        }

        Schema::table('nodes', function (Blueprint $table) {
            $table->dropFullText('nodes_fulltext');
        });
    }
};
