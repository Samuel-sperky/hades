<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Plánované behy konzoly — čo má agent spustiť sám, bez človeka pri klávesnici.
 *
 * Rozvrh je zámerne dáta, nie kód v `routes/console.php`. Rozvrh smie vyrobiť aj
 * AI cez MCP tool `console_schedules` a smie ho zapnúť len človek; obidve tie
 * vlastnosti sa nedajú mať, keď je zoznam v súbore, ktorý sa nasadzuje.
 *
 * Beh rozvrhu ide vždy cez `HeadlessRunner`, teda s read-only sadou toolov.
 * Zápisový tool by ťah zaparkoval rámcom `permission` a v noci pri tom nikto nie
 * je — vlákno by zamrzlo natrvalo.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('console_schedules', function (Blueprint $table) {
            $table->id();
            // uuid je verejný identifikátor rozvrhu: pod ním ho vracia MCP tool a
            // pod ním ho človek zapína cez artisan. `id` v tých miestach by
            // prezrádzalo, koľko rozvrhov si už AI navrhla.
            $table->uuid('uuid')->unique();
            $table->string('label');
            // celý prompt, nie odkaz na šablónu — rozvrh musí zostať čitateľný aj
            // rok po tom, čo ho niekto založil
            $table->text('prompt');
            // cron výraz v päťpoľovom tvare; platnosť overuje model pri ukladaní
            // (Cron\CronExpression), takže do DB sa nemá ako dostať nezmysel
            $table->string('cron');
            // čím to spustiť; null = default z config('hades.console')
            $table->string('provider')->nullable();
            $table->string('model')->nullable();
            // ZAPNUTIE JE ROZHODNUTIE ČLOVEKA, preto default FALSE. Rozvrh smie
            // vytvoriť aj AI cez MCP, a rozvrh, ktorý sa sám rozbehne každú
            // minútu, je spálené CPU (lokálny model beží na CPU aj minúty) bez
            // toho, aby o tom človek vedel. Keby bol default TRUE, stačil by
            // jeden zlý odhad modelu na to, aby stroj mlel do rána.
            $table->boolean('enabled')->default(false);
            $table->timestamp('last_run_at')->nullable();
            // uuid vlákna posledného behu, NIE cudzí kľúč: práve uuid berie
            // `console_result`, takže je to jediná hodnota, s ktorou sa dá výsledok
            // dočítať. FK by navyše nútil vybrať medzi „mazanie vlákna zhodí
            // históriu rozvrhu" a „vlákno sa nedá zmazať".
            $table->string('last_thread_id')->nullable();
            $table->timestamps();

            // scheduler sa každú minútu pýta presne na toto
            $table->index('enabled');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('console_schedules');
    }
};
