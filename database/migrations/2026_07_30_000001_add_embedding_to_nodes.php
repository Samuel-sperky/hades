<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Aditívna migrácia (balík P1) — vektory uzlov sa ukládajú priamo v MariaDB,
 * žiadna vektorová databáza (rozhodnutie #112b).
 *
 * `embedding` je packed float32 little-endian (pack('g*')), takže dimenzia sa
 * dá odvodiť z dĺžky blobu: strlen($blob) / 4. bge-m3 = 1024 dim = 4096 B.
 *
 * `embedding_hash` je sha256 textu, z ktorého vektor vznikol. Bez neho by sa
 * „treba prepočítať?" muselo odvodzovať z `updated_at`, ktorý sa mení pri každej
 * aktivácii (strength++) — nočný rewire/decay by tak zbytočne prepočítal celý
 * korpus. S hashom je `aura:embed` idempotentný a prepočíta presne tie uzly,
 * ktorým sa zmenil text alebo model.
 *
 * Žiadny DROP ani zmena existujúceho stĺpca; down() len odoberá pridané stĺpce.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('nodes', function (Blueprint $table) {
            // BLOB (65 535 B) — bge-m3 potrebuje 1024 × float32 = 4 096 B, teda
            // strop je ~16 000 dimenzií. Kontrakt spomínal LONGBLOB, ale ten by
            // znamenal raw ALTER mimo Blueprintu za nulový úžitok.
            $table->binary('embedding')->nullable()->after('meta');
            $table->string('embedding_model', 64)->nullable()->after('embedding');
            $table->char('embedding_hash', 64)->nullable()->after('embedding_model');
            $table->dateTime('embedded_at')->nullable()->after('embedding_hash');

            $table->index('embedded_at');
        });
    }

    public function down(): void
    {
        Schema::table('nodes', function (Blueprint $table) {
            $table->dropIndex(['embedded_at']);
            $table->dropColumn(['embedding', 'embedding_model', 'embedding_hash', 'embedded_at']);
        });
    }
};
