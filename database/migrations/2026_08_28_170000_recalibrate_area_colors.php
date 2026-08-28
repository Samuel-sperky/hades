<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Prekalibrovanie farieb oblastí na odstup tónu (kontrakt 28. 8. 2026, B4).
 *
 * Prečo migrácia a nie len seeder: seeder používa firstOrCreate, takže na
 * existujúcej databáze farbu NEPREPÍŠE — a táto databáza je živá od 2025-09.
 * Bez migrácie by nová sada platila len pre čistú instalaciu a jediná bežiaca
 * appka na svete (táto) by kreslila staré tóny.
 *
 * Prečo je to bezpečné: mení sa jeden textový stĺpec piatich riadkov, ktorý
 * nesie iba vzhľad. Uzly, hrany ani zaradenie sa nedotýkajú. Zápis je
 * podmienený starou hodnotou, takže druhé spustenie nič nezmení a ručná
 * úprava farby (ak si ju niekto medzitým prepísal) zostane nedotknutá.
 */
return new class extends Migration
{
    /** slug => [stará, nová] — podmienka na starú hodnotu drží idempotenciu */
    private const MAP = [
        'marketing-seo'      => ['#b88a3a', '#5b7328'],
        'vyvoj-kod'          => ['#03797e', '#007b76'],
        'dizajn-kreativa'    => ['#9d5c7a', '#8d5081'],
        'biznis-projekty'    => ['#2f6d8f', '#3c6aa4'],
        'osobne-preferencie' => ['#a86a4a', '#9c503e'],
    ];

    public function up(): void
    {
        foreach (self::MAP as $slug => [$old, $new]) {
            DB::table('areas')->where('slug', $slug)->where('color', $old)
                ->update(['color' => $new]);
        }
    }

    public function down(): void
    {
        foreach (self::MAP as $slug => [$old, $new]) {
            DB::table('areas')->where('slug', $slug)->where('color', $new)
                ->update(['color' => $old]);
        }
    }
};
