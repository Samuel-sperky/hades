<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Úzke povolenia vlákna — „povoliť vždy" pre tool, ktorého argument je príliš
 * široký na plošné `auto_accept`.
 *
 * Dôvod je bezpečnostný a je konkrétny: od 19. 8. 2026 má konzola tool `bash`.
 * Keby jeho „povoliť vždy" zapínalo `auto_accept` (ako pri ostatných zápisových
 * tooloch), jedno kliknutie pri `php artisan test` by v tom vlákne ticho povolilo
 * aj `mind_delete` a `write_file` — teda mazanie uzlov pamäte bez ďalšej otázky.
 *
 * Tvar: `{"bash": ["php artisan test", "git status"]}`. Kľúč je meno toolu,
 * hodnoty sú vzory z {@see App\Services\Console\CommandCage::pattern()}.
 *
 * Prečo JSON stĺpec a nie vlastná tabuľka: povolenie nemá vlastný životný cyklus
 * ani sa nad ním nedopytuje — vždy sa čítajú VŠETKY povolenia práve jedného
 * vlákna a zomrú s ním. Tabuľka by k tomu pridala join a FK bez jedinej otázky,
 * na ktorú by odpovedala lepšie.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('console_threads', function (Blueprint $table) {
            $table->json('allowances')->nullable()->after('auto_accept');
        });
    }

    public function down(): void
    {
        Schema::table('console_threads', function (Blueprint $table) {
            $table->dropColumn('allowances');
        });
    }
};
