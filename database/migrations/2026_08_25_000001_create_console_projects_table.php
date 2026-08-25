<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Projekty (zložky) vlákien — a organizácia bočného panelu.
 *
 * **Nová tabuľka, nie stĺpec `console_threads.project`.** Reťazec v stĺpci by dal
 * zoskupenie a nič viac: premenovanie by bol `UPDATE` naprieč vláknami (a preklep
 * by rozdvojil projekt na dva), pripnutie a archivácia by nemali kam sadnúť,
 * prázdny projekt by neexistoval, a projekt by nemal verejný identifikátor, na
 * ktorý sa dá odkázať URL. Vlákno patrí najviac do JEDNÉHO projektu, takže na
 * druhej strane netreba ani pivot — pivot pre vzťah 0..1 dovoľuje, čo schéma
 * zakazuje, a musel by si to brať späť unikátnym indexom.
 *
 * `console_threads.project_id` je **`nullable` a bez `default`**: „bez projektu"
 * je normálny a najčastejší stav vlákna, nie chýbajúca hodnota. `default(0)` by
 * bol navyše neplatný cudzí kľúč.
 *
 * Cudzí kľúč je `nullOnDelete`, **nie `cascadeOnDelete`**. Je to to isté
 * rozhodnutie ako v `2026_08_20_000001_keep_runs_when_a_thread_is_deleted`:
 * s kaskádou by jeden klik „zmazať projekt" zmazal všetky konverzácie v ňom.
 * Zmazanie zložky má vlákna vysypať, nie spáliť.
 *
 * `pinned_at` / `archived_at` sú **nullable timestampy, nie boolean**. `null`
 * prirodzene znamená „nepripnuté / neodložené" a dátum navyše nesie poradie
 * pripnutých, ktoré by sa pri booleane muselo dopočítať odniekiaľ inde.
 *
 * Počet vlákien v projekte tu **nie je** a nemá byť: denormalizovaný počítadlo je
 * presne tá chyba, ktorú našiel audit 19. 8. 2026 (Denník počítal čipy projektov
 * z 50 načítaných záznamov, takže čip sľuboval číslo, ktoré zoznam nedal).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('console_projects', function (Blueprint $table) {
            $table->id();

            // uuid nesie URL (/chat/projekt/<uuid>) — id v adrese by prezrádzalo
            // počet projektov, rovnako ako pri vláknach a behoch.
            $table->uuid('uuid')->unique();

            // Premenovanie je UPDATE jedného riadku. Bez unikátneho indexu
            // zámerne: dva projekty s tým istým menom sú neporiadok, nie chyba
            // dát, a odmietnutie uloženia mena by človeka zastavilo pri práci.
            $table->string('name', 120);

            $table->timestamp('pinned_at')->nullable();
            $table->timestamp('archived_at')->nullable();
            $table->timestamps();

            // Bez indexov. Bočný panel čítá VŠETKY projekty (sú ich jednotky až
            // desiatky) a radí ich `archived_at IS NULL`, `pinned_at DESC`,
            // `name`. Index nad tabuľkou, ktorá sa vždy číta celá, je náklad na
            // zápis bez čitateľa — rovnaká úvaha ako u `LIKE` nad `runs.prompt`
            // v RunsScreen.
        });

        Schema::table('console_threads', function (Blueprint $table) {
            // Poradie príkazov je zámerné: stĺpec → index → cudzí kľúč. InnoDB si
            // pre cudzí kľúč vyrobí vlastný index, len ak žiadny vhodný ešte
            // neexistuje; keď je zložený index s `project_id` na prvom mieste už
            // na svete, FK ho použije a druhý index nevznikne.
            $table->unsignedBigInteger('project_id')->nullable()->after('uuid');

            // Vlákno sa dá pripnúť a archivovať aj bez projektu — sú to dve
            // nezávislé osi (zložka × poradie/viditeľnosť), nie jedna.
            $table->timestamp('pinned_at')->nullable()->after('auto_accept');
            $table->timestamp('archived_at')->nullable()->after('pinned_at');

            // Dopyt panelu je `WHERE project_id = ? ORDER BY last_message_at DESC`.
            // Zložený index ho pokryje celý (filter aj radenie), takže tu index ÁNO —
            // na rozdiel od `console_projects`, ktorý sa číta celý.
            $table->index(['project_id', 'last_message_at']);

            $table->foreign('project_id')->references('id')->on('console_projects')->nullOnDelete();

            // `pinned_at` a `archived_at` index NEDOSTÁVAJÚ. Panel ich používa ako
            // filter nad rádovo stovkami vlákien a `archived_at IS NULL` má nízku
            // kardinalitu — index by plánovač aj tak preskočil.
        });
    }

    public function down(): void
    {
        // Poradie je opačné než v `up()` a každý krok má vlastné `Schema::table`,
        // aby sa nedal preusporiadať:
        //  1. cudzí kľúč — MySQL neuvoľní index, kým ho FK potrebuje;
        //  2. index — SQLite (Laravel 13 pustí natívne `ALTER TABLE DROP COLUMN`)
        //     odmietne zmazať indexovaný stĺpec;
        //  3. samotné stĺpce.
        Schema::table('console_threads', function (Blueprint $table) {
            $table->dropForeign(['project_id']);
        });

        Schema::table('console_threads', function (Blueprint $table) {
            $table->dropIndex(['project_id', 'last_message_at']);
        });

        Schema::table('console_threads', function (Blueprint $table) {
            $table->dropColumn(['project_id', 'pinned_at', 'archived_at']);
        });

        Schema::dropIfExists('console_projects');
    }
};
