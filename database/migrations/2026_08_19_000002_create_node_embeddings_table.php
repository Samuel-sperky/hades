<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Vektory uzlov pre semantický recall — druhá polovica hľadania vedľa kľúčových
 * slov. Doteraz sa poznatok formulovaný inými slovami než dopyt nenašiel vôbec.
 *
 * Prečo BLOB a nie JSON: vektor je 1024 čísel (bge-m3). Ako JSON je to ~20 kB
 * textu na uzol, ktorý pri každom dopyte prejde `json_decode` — nad 2 700 uzlami
 * je to 54 MB parsovania na jeden recall. Ako packed float32 je to 4 kB na uzol,
 * teda ~11 MB na celý korpus, a `unpack('g*')` je jedno prečítanie pamäte.
 * Presnosť float32 stojí kosínus asi 1e-7, čo je o štyri rády pod rozdielom,
 * ktorý vie rozhodnúť poradie.
 *
 * Prečo nie natívny VECTOR: MariaDB ho má až od 11.7, tu beží 11.4 — a upgrade
 * databázy pod živou pamäťou je väčšie riziko než brute-force kosínus nad 2 700
 * riadkami. Namerané v tomto kontejneri: 2 667 × 1024 `unpack('g*')` + skalárny
 * súčin = 57 ms na jeden dopyt, teda menej než samotná vektorizácia dopytu
 * (~260 ms na CPU). Index by tu šetril nemerateľnú časť. Sqlite, na ktorom bežia testy,
 * natívny vektorový typ nemá vôbec, takže BLOB je jediné uloženie, ktoré je na
 * oboch databázach TO ISTÉ — schéma sa nesmie líšiť medzi testom a prevádzkou.
 *
 * `norm` je predpočítaná L2 norma. Kosínus nad celým korpusom by ju inak
 * počítal pri každom dopyte znova (2 700 × 1024 odmocnení a súčtov na nič —
 * vektor sa od zápisu nemení).
 *
 * `source_hash` je odtlačok textu, ktorý sa vektorizoval. Bez neho by
 * prevektorizovanie znamenalo 2 700 CPU inferencií pokaždé; s ním beží
 * `mind:embed` len nad tým, čo sa reálne zmenilo.
 *
 * Unikát je (node_id, model), nie samotný node_id: výmena embedding modelu je
 * reálna operácia (bge-m3 ↔ embeddinggemma) a vektory dvoch modelov sa medzi
 * sebou porovnávať nedajú. Takto môžu koexistovať, dopyt si vyberie svoj model
 * a prechod nepotrebuje zahodiť starú sadu skôr, než je nová hotová.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('node_embeddings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('node_id')->constrained()->cascadeOnDelete();
            $table->string('model');
            // dimenzia je vlastnosť odpovede modelu, nie konfigurácie — ukladá sa,
            // aby dopyt vedel preskočiť riadok, ktorý vznikol iným modelom pod
            // tým istým menom (skalárny súčin dvoch rôznych dĺžok je nezmysel)
            $table->unsignedInteger('dimensions');
            $table->binary('vector');
            $table->double('norm');
            $table->string('source_hash', 64);
            $table->timestamps();

            $table->unique(['node_id', 'model']);
            // dopyt skenuje celú sadu jedného modelu po dávkach cez chunkById,
            // takže hľadá (model, id) — samotný unikát vyššie na to nesedí
            $table->index(['model', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('node_embeddings');
    }
};
