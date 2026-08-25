<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Prílohy správy — súbory, obrázky, PDF.
 *
 * ## Obsah NIE JE v databáze
 *
 * Blob v DB by sa objavil v každom `mysqldump`, a záloha pred migráciou je tu
 * povinná (kritérium §5/11 kontraktu, posledné 3 v `backups/`) — jedno 20 MB PDF
 * by teda stálo 60 MB záloh a rástlo lineárne s tým, čo človek nahodí do chatu.
 * Druhý dôvod: stiahnutie z blobu znamená celý súbor v pamäti PHP workera, ktorých
 * je osem. Preto **obsah na disk, metadáta do DB**.
 *
 * ## Kde na disku, a ako to nekoliduje s `PathGuard`
 *
 * Koreň príloh je vlastný config kľúč (`hades.console.attachments_root`, default
 * `storage_path('app/console-attachments')`) a v ňom
 * `<thread-uuid>/<attachment-uuid>.<ext>`.
 *
 * Meno na disku vyrába **uuid, nikdy `original_name`**. Názov od človeka sa
 * ukladá len na zobrazenie a na `Content-Disposition`; do cesty sa nedostane, tak
 * ako sa doňho nedostane žiadny vstup od cudzieho.
 *
 * `PathGuard` sa tým **neoslabuje a ani neobchádza** — na tejto ceste vôbec nie
 * je, pretože žiadna cesta od klienta na filesystem nevedie: sťahovanie berie
 * `uuid`, vyhľadá riadok a číta `path`. Dve veci to ale vyžaduje od vlny, ktorá
 * upload postaví (a §5/6 kontraktu ich pinuje testom):
 *
 *  1. `path` sa pred čítaním rozloží (`realpath`) a musí padnúť DO koreňa príloh.
 *     Riadok, ktorého `path` vedie inam, sa **odmietne, nesanitizuje** — to isté
 *     pravidlo ako v `PathGuard`, len s druhým, úzkym koreňom. Preto je `path`
 *     v DB relatívny ku koreňu: absolútna cesta v riadku by kontrolu robila
 *     nejednoznačnou.
 *  2. Default koreň leží POD `hades.console.files_root` (ten je `base_path()`),
 *     takže bez zásahu by prílohy vedel čítať súborový tool modelu — a model vo
 *     vlákne A by videl prílohu vlákna B. Do `PathGuard::DENY_PREFIXES` preto
 *     musí pribudnúť `storage/app/console-attachments`. Fail-closed: kým tam
 *     nepribudne, prílohy sa nikam neukladajú.
 *
 * ## Čo sa stane s prílohou pri zmazaní vlákna
 *
 * Riadok ide kaskádou (`thread_id`, a druhou cestou `message_id`). Súbor kaskáda
 * nezmaže, takže sú na to dve cesty a obe treba:
 *
 *  - `ThreadController::destroy` zmaže priečinok `<koreň>/<thread-uuid>/` — je
 *    odvoditeľný z uuid, takže na to netreba prečítať ani jeden riadok;
 *  - zametač (vzor: `mind:reap-runs`) dobehne to, čo padlo pri smrti procesu, a
 *    zároveň zmaže **rozpracované prílohy** (`message_id IS NULL`) starší než
 *    niekoľko hodín — to sú súbory, ktoré človek nahodil do vstupu a správu
 *    neposlal.
 *
 * **Súbor sa nikdy nemaže pri mazaní riadku, len zametačom a len keď naň
 * neukazuje žiadny riadok.** Dôvod je vetvenie: keď editácia správy založí novú
 * vetvu, prílohy sa skopírujú ako RIADKY (nové uuid, ten istý `path`) a súbor sa
 * needituje ani nekopíruje. Keby mazanie riadku mazalo súbor, zmazanie jednej
 * vetvy by vytrhlo prílohu druhej.
 *
 * Vetvu prílohy nenesú — visia na `message_id` a vetvu dedia po svojej správe,
 * rovnako ako `console_tool_calls`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('console_attachments', function (Blueprint $table) {
            $table->id();

            // Verejný identifikátor: je v URL na stiahnutie a je to zároveň meno
            // súboru na disku. Poradové id by v odkaze prezrádzalo, koľko súborov
            // do appky kto nahral.
            $table->uuid('uuid')->unique();

            $table->foreignId('thread_id')->constrained('console_threads')->cascadeOnDelete();

            // `nullable`, pretože upload je PRED odoslaním správy: človek priloží
            // súbor, potom píše, a správa vznikne až pri odoslaní. `null` teda
            // znamená „rozpracované vo vstupe" — je to živý stav, nie chýbajúci
            // údaj, a zametač podľa neho vie, čo je odpad.
            //
            // Kaskáda a nie `nullOnDelete` (na rozdiel od
            // `console_tool_calls.message_id`): tool call bez svojej správy je
            // stále čitateľný záznam v logu, ale príloha bez správy, ktorá už
            // existovala, je nedosiahnuteľný súbor.
            $table->foreignId('message_id')->nullable()
                ->constrained('console_messages')->cascadeOnDelete();

            // Ako sa súbor menoval u človeka. Len na zobrazenie a na stiahnutie —
            // do cesty sa nikdy nedostane.
            $table->string('original_name');

            // Cesta RELATÍVNA ku koreňu príloh. Bez unikátneho indexu zámerne:
            // dve vetvy jedného vlákna zdieľajú jeden súbor (viď docblock).
            $table->string('path');

            // Typ zistený NA SERVERI, nie prevzatý z requestu — `Content-Type` od
            // klienta je tvrdenie, nie fakt, a od typu závisí náhľad aj to, či sa
            // z prílohy ťahá text.
            $table->string('mime', 128);

            $table->unsignedBigInteger('size_bytes');

            // Integrita pri stiahnutí a lacný kľúč na budúcu deduplikáciu.
            // `nullable`: `null` znamená „nepočítané" (starý alebo dopĺňaný riadok),
            // nie „súbor bez odtlačku". Index nedostáva — dedup zatiaľ nikto
            // nerobí a index bez čitateľa je náklad.
            $table->char('sha256', 64)->nullable();

            // Vytiahnutý text (PDF, plain). Je to CACHE, nie druhá kópia obsahu:
            // model potrebuje text v prompte a parsovať to isté PDF pri každom
            // z dvadsiatich ťahov je na CPU inferencii nezmysel.
            $table->longText('text_content')->nullable();

            // Dvojstavovosť bez enumu: `extracted_at` je `null` → extrakcia ešte
            // nebežala; je nastavené a `text_content` je `null` → bežala a text
            // v súbore nie je (obrázok, binárka). Bez tohto stĺpca by sa fronta
            // nemala ako dozvedieť, že to už skúsila.
            $table->timestamp('extracted_at')->nullable();

            $table->timestamps();

            // Dva dopyty, jeden index: prílohy správ pri skládaní histórie
            // (`message_id IN (...)`) a rozpracované prílohy vlákna
            // (`thread_id = ? AND message_id IS NULL`). Zložený index s
            // `thread_id` na prvom mieste pokrýva druhý a slúži cudziemu kľúču
            // vlákna; `message_id` má vlastný index od svojho cudzieho kľúča.
            $table->index(['thread_id', 'message_id']);
        });
    }

    public function down(): void
    {
        // Tabuľka nie je rodičom žiadneho cudzieho kľúča, takže `down()` je jeden
        // príkaz. Súbory na disku migrácia nemaže — to je práca zametača; migrácia,
        // ktorá pri `down()` maže dáta z disku, je nevratná napriek svojmu menu.
        Schema::dropIfExists('console_attachments');
    }
};
