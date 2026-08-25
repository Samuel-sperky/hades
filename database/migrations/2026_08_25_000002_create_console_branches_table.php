<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Vetvenie konverzácie — editácia vlastnej správy a znovu-vygenerovanie, pôvodná
 * vetva zostáva.
 *
 * ## Ako je vetva reprezentovaná
 *
 * Vetva je riadok v `console_branches` s dvoma ukazovateľmi:
 *  - `parent_branch_id` — z ktorej vetvy vyrastá (`null` = korenná vetva vlákna),
 *  - `forked_from_message_id` — POSLEDNÁ správa rodičovskej vetvy, ktorú si táto
 *    vetva dedí (`null` len na korennej).
 *
 * Každá správa dostane `console_messages.branch_id`. Aktívna vetva vlákna je
 * `console_threads.active_branch_id`.
 *
 * **Správy sa nikdy neprepisujú ani nemažú.** Editácia správy človeka založí novú
 * vetvu, ktorá dedí prefix po `forked_from_message_id`, a upravená správa je jej
 * prvý vlastný záznam. Pôvodná správa zostáva tam, kde bola, a stará vetva je
 * čitateľná ďalej.
 *
 * ## Ako sa skládá história jednej vetvy
 *
 * V PHP sa vyjde od aktívnej vetvy nahor po korennú (vetiev na vlákno sú
 * jednotky, takže je to jeden `SELECT` nad `console_branches` a prechod pamäťou),
 * čím vznikne reťaz `[(branch_id, strop id)]`. Potom JEDEN dopyt:
 *
 *     SELECT * FROM console_messages
 *      WHERE thread_id = :thread
 *        AND (   branch_id = 3                              -- aktívna, bez stropu
 *             OR (branch_id = 2 AND id <= 820)              -- dedený prefix
 *             OR ((branch_id = 1 OR branch_id IS NULL) AND id <= 500) )
 *      ORDER BY id
 *
 * Žiadna rekurzia v SQL a žiadne CTE (sqlite aj MariaDB by ho zvládli, ale nie je
 * naň dôvod). Dolná hranica v podmienkach chýbať MÔŽE: vetva vznikla po svojom
 * odbočení, takže všetky jej vlastné správy majú `id` väčšie než jej
 * `forked_from_message_id`. A `ORDER BY id` je správne konverzačné poradie aj
 * naprieč vetvami, pretože `id` je poradie vzniku a dedený prefix je vždy starší
 * než vlastné správy vetvy.
 *
 * `branch_id IS NULL` v korennej vetve je záchranná sieť, nie cesta dopytu:
 * `up()` nižšie dopĺňa `branch_id` všetkým existujúcim správam, takže po migrácii
 * je NULLov nula. Keby ich niekto v budúcnosti vyrobil (zápis, ktorý zabudol
 * vetvu), správa sa objaví v korennej vetve — teda v pôvodnom, lineárnom chovaní.
 * To je horší z dvoch stavov, ale je VIDITEĽNÝ; neviditeľná správa by bola horšia.
 *
 * ## Prečo to nerozbije rozsah `runs`
 *
 * `runs` nesie členstvo správ **rozsahom id** (`from_message_id`–`to_message_id`)
 * a `Run::messages()` ho čítá ako `whereBetween` nad `thread_id`. Vetvenie ten
 * rozsah nerozbíja z dvoch dôvodov:
 *
 *  1. `console_messages.id` je autoincrement, takže vetva **pripája na koniec**.
 *     Nová vetva nikdy nevloží správu medzi `from_message_id` a `to_message_id`
 *     staršieho behu — vkladanie do stredu histórie je jediná operácia, ktorá by
 *     rozsah pokazila, a schéma ju neumožňuje.
 *  2. Vo vlákne beží **jeden ťah naraz** a to sa vetvením NEMENÍ:
 *     `RunRecorder::openExclusive()` zamyká riadok VLÁKNA a `RunController::run`
 *     odmietne správu, kým čaká nedorozhodnutý zápis. Vetvy žijú vnútri jedného
 *     vlákna, takže prepnutie vetvy nevyrába druhého pisateľa.
 *
 * **Toto je nosná veta celej migrácie: exkluzivita behu je na úrovni VLÁKNA, nie
 * vetvy.** Keby niekto neskôr „optimalizoval" súbežný beh dvoch vetiev jedného
 * vlákna, každý rozsah v tom vlákne sa stane nepresným (beh by hlásil cenu
 * cudzieho ťahu a v detaile ukázal cudzie správy). Test to musí pinovať.
 *
 * `runs.branch_id` je preto **doplnok, nie zdroj členstva**: hovorí, ktorú vetvu
 * ten beh predĺžil, aby to log ukázal bez načítania správ. Ako druhý pás k
 * rozsahu môže `Run::messages()` pridať `->where('branch_id', $run->branch_id)`,
 * keď nie je `null` — potom by aj taká budúca chyba dala menšiu, ale čistú
 * množinu namiesto zmiešanej.
 *
 * `console_tool_calls` **vetvu nedostávajú**: visia na `message_id`, takže vetvu
 * dedia po svojej správe. Tretí stĺpec s tou istou informáciou by sa rozišiel.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('console_branches', function (Blueprint $table) {
            $table->id();

            // Vetva má vlastný verejný identifikátor — prepínanie vetiev je odkaz
            // (/chat/<thread-uuid>?vetva=<uuid>), a poradové id by prezrádzalo,
            // koľkokrát sa človek vo vlákne vracal.
            $table->uuid('uuid')->unique();

            $table->foreignId('thread_id')->constrained('console_threads')->cascadeOnDelete();

            // Self-FK s kaskádou je tu zadarmo, pretože je súčasťou CREATE TABLE
            // (v `down()` sa tabuľka celá zahodí, takže nie je čo odopínať).
            // Kaskáda a nie `nullOnDelete`: potomok bez svojho prefixu nie je
            // korenná vetva, je to nezmyselný záznam.
            $table->foreignId('parent_branch_id')->nullable()
                ->constrained('console_branches')->cascadeOnDelete();

            // BEZ cudzieho kľúča na `console_messages` — presne ako
            // `runs.from_message_id`. Cudzí kľúč sem by uzavrel kruh kaskád
            // (messages → branches → messages) a jediné, čo by naozaj priniesol,
            // je nezmazateľný stĺpec.
            $table->unsignedBigInteger('forked_from_message_id')->nullable();

            $table->timestamps();

            // Prepínač vetiev čítá všetky vetvy vlákna naraz.
            $table->index(['thread_id', 'id']);

            // `parent_branch_id` vlastný index nedostáva: InnoDB si ho pre cudzí
            // kľúč vyrobí sám a strom vetiev jedného vlákna má jednotky riadkov.
        });

        Schema::table('console_threads', function (Blueprint $table) {
            // BEZ cudzieho kľúča, a to zámerne v oboch smeroch:
            //  - `console_branches.thread_id` už ukazuje sem, takže FK odtiaľ tam
            //    by bol vzájomný kruh, ktorý sa v `down()` musí rozpájať v presnom
            //    poradí a na sqlite bráni zmazaniu stĺpca;
            //  - podmienku, na ktorej naozaj záleží („aktívna vetva patrí TOMUTO
            //    vláknu"), cudzí kľúč vyjadriť nevie.
            // Keď vetva zmizne, `active_branch_id` visí a čítanie spadne na
            // korennú vetvu vlákna. To je definovaný stav, nie chyba.
            $table->unsignedBigInteger('active_branch_id')->nullable()->after('uuid');
        });

        Schema::table('console_messages', function (Blueprint $table) {
            // `nullable`, hoci po backfille nižšie žiadny NULL neexistuje: zmena na
            // NOT NULL by na sqlite znamenala prestavbu tabuľky a na MariaDB zámok
            // nad hot tabuľkou, a NULL má definovaný, viditeľný význam (viď
            // docblock). Nie je to „chýbajúca hodnota do zásoby".
            $table->unsignedBigInteger('branch_id')->nullable()->after('thread_id');

            // Stĺpec → index → cudzí kľúč (viď migrácia projektov): index
            // `['branch_id', 'id']` pokrýva dopyt histórie vetvy celý — filter aj
            // `ORDER BY id` — a zároveň poslúži cudziemu kľúču, takže InnoDB
            // druhý index nevyrobí.
            $table->index(['branch_id', 'id']);

            // Kaskáda: správy mŕtvej vetvy nemá kto prečítať. Vlákno kaskáduje na
            // správy aj na vetvy, takže zmazanie vlákna dá ten istý výsledok ako
            // doteraz — dve kaskádové cesty do tej istej tabuľky InnoDB dovoľuje.
            $table->foreign('branch_id')->references('id')->on('console_branches')->cascadeOnDelete();
        });

        Schema::table('runs', function (Blueprint $table) {
            // Ktorú vetvu beh predĺžil. BEZ cudzieho kľúča z toho istého dôvodu,
            // z akého je `thread_id` `nullOnDelete`: log behov má prežiť zmazanie
            // toho, o čom hovorí. Kaskáda by zmazaním vetvy zmazala jej behy, a to
            // je presne to, čo `keep_runs_when_a_thread_is_deleted` naprávalo.
            // Visiaci ukazovateľ je čitateľný stav („vetva už neexistuje"),
            // rovnako ako dnešné `thread = null`.
            $table->unsignedBigInteger('branch_id')->nullable()->after('thread_id');

            // Index NIE. Zoznam behov sa vždy zužuje najprv časom
            // (`['status','started_at']`, `started_at`) alebo vláknom
            // (`['thread_id','id']`); vetva je až posledné dozúženie nad rádovo
            // desiatkami riadkov. Prehodnotiť, keď `runs` narastie o rád — nie skôr.
        });

        // ---- backfill ------------------------------------------------------
        //
        // Existujúce vlákna dostanú korennú vetvu a všetky ich správy aj behy sa
        // do nej zapíšu. Nie je to kozmetika: až do dnes bola konverzácia lineárna,
        // takže „táto správa patrí do hlavnej vetvy" je PRAVDA, ktorú poznáme —
        // na rozdiel od `runs.tool_profile`, kde `null` znamenalo „nikto to
        // nezaznamenal" a dopisovať `'full'` by bola vymyslená história.
        //
        // Zapisuje sa cez `DB::table`, nie cez modely: modely sa menia, migrácia
        // musí dať ten istý výsledok aj za rok.
        DB::table('console_threads')->orderBy('id')->select('id')->chunkById(200, function ($threads) {
            foreach ($threads as $thread) {
                $now = now();

                $branchId = DB::table('console_branches')->insertGetId([
                    'uuid' => (string) Str::uuid(),
                    'thread_id' => $thread->id,
                    'parent_branch_id' => null,
                    'forked_from_message_id' => null,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);

                DB::table('console_threads')->where('id', $thread->id)
                    ->update(['active_branch_id' => $branchId]);

                DB::table('console_messages')->where('thread_id', $thread->id)
                    ->update(['branch_id' => $branchId]);

                DB::table('runs')->where('thread_id', $thread->id)
                    ->update(['branch_id' => $branchId]);
            }
        });
    }

    public function down(): void
    {
        // Najprv sa uvolní `console_messages` (FK → index → stĺpec, každý vo
        // vlastnom `Schema::table`, aby sa poradie nedalo preusporiadať), potom
        // ukazovatele bez cudzích kľúčov, a až nakoniec tabuľka vetiev — inak by
        // MySQL odmietol zahodiť rodiča živého cudzieho kľúča.
        Schema::table('console_messages', function (Blueprint $table) {
            $table->dropForeign(['branch_id']);
        });

        Schema::table('console_messages', function (Blueprint $table) {
            $table->dropIndex(['branch_id', 'id']);
        });

        Schema::table('console_messages', function (Blueprint $table) {
            $table->dropColumn('branch_id');
        });

        Schema::table('runs', function (Blueprint $table) {
            $table->dropColumn('branch_id');
        });

        Schema::table('console_threads', function (Blueprint $table) {
            $table->dropColumn('active_branch_id');
        });

        Schema::dropIfExists('console_branches');
    }
};
