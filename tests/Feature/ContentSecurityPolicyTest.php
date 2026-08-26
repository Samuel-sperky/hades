<?php

namespace Tests\Feature;

use Tests\TestCase;

/**
 * CSP hlavička na HTML plochách appky.
 *
 * Tento test vznikol z nálezu: docblock v `ContentSecurityPolicy` sľuboval test,
 * ktorý pinuje, že CDN `<script src>` je len na jednej ploche — a taký test
 * **nikdy neexistoval** (`grep -rln 'Content-Security-Policy' tests/` = 0 zásahov).
 * Komentár teda tvrdil o projekte niečo, čo v ňom nebolo. Odvtedy sa `d3` a
 * `pusher-js` self-hostli do `public/js/vendor/`, takže `script-src` je `'self'`
 * na všetkých plochách — ale kým to nedrží test, drží to len disciplína toho, kto
 * naposledy editoval blade.
 *
 * Testuje sa **odpoveď 401**, nie odomknutá plocha, a je to zámer: `auth.ui`
 * odpovedá skôr než sa dostane na view, takže je to najlacnejší spôsob, ako sa
 * dotknúť hlavičky na všetkých troch routách. Práve preto je CSP v
 * `bootstrap/app.php` zaradená PRED guard — `errors/401.blade.php` má inline
 * `<style>` blok a je celé odôvodnenie `style-src 'unsafe-inline'`.
 */
class ContentSecurityPolicyTest extends TestCase
{
    /** Tri HTML plochy appky. */
    private const SURFACES = ['/', '/console', '/chat'];

    /**
     * Meno hlavičky sa musí zhodovať s fázou zavedenia. Kým je `REPORT_ONLY`,
     * prehliadač nič neblokuje — a test, ktorý by to nerozlišoval, by prešel aj
     * vtedy, keby politika nič nevynucovala ani po prepnutí.
     */
    private function policyOf(string $uri): string
    {
        $response = $this->get($uri);
        $headers = $response->headers;

        $header = $headers->has('Content-Security-Policy')
            ? 'Content-Security-Policy'
            : 'Content-Security-Policy-Report-Only';

        $this->assertTrue(
            $headers->has($header),
            "Plocha {$uri} neposiela CSP hlavičku vôbec."
        );

        return (string) $headers->get($header);
    }

    public function test_every_html_surface_carries_a_csp_header(): void
    {
        foreach (self::SURFACES as $uri) {
            $policy = $this->policyOf($uri);

            $this->assertStringContainsString("default-src 'self'", $policy, "Plocha {$uri}");
        }
    }

    /**
     * `script-src` je `'self'` a NIČ VIAC — na každej ploche rovnako.
     *
     * Toto je ten test, ktorý zachytí návrat CDN. Do 26. 8. 2026 dostávala route
     * `/` navyše `https://cdn.jsdelivr.net`, pretože odtiaľ šli `d3` a `pusher-js`
     * bez `integrity` — politika teda povolila **host, nie obsah**, a appka je
     * verejne tunelovaná cez ngrok.
     */
    public function test_script_src_is_self_only_on_every_surface(): void
    {
        foreach (self::SURFACES as $uri) {
            $policy = $this->policyOf($uri);

            $this->assertStringContainsString("script-src 'self'", $policy, "Plocha {$uri}");
            $this->assertStringNotContainsString('jsdelivr', $policy, "Plocha {$uri} povoľuje CDN skripty.");
            $this->assertStringNotContainsString('unpkg', $policy, "Plocha {$uri} povoľuje CDN skripty.");

            // Presný rez direktívy: `script-src 'self'` nesmie mať za sebou zdroj.
            // Bez tejto asercie by prešlo aj `script-src 'self' https://…`.
            preg_match("/script-src ([^;]+)/", $policy, $m);
            $this->assertSame(
                "'self'",
                trim($m[1] ?? ''),
                "Plocha {$uri}: `script-src` má okrem 'self' ešte ďalší zdroj."
            );
        }
    }

    /**
     * `'unsafe-inline'` sa nesmie priplichtiť do `script-src`.
     *
     * Je povolené v `style-src` a je to zmeraná nutnosť (10 miest v
     * `public/js/mind` vkladá `style="…"` cez `innerHTML`, a `errors/401.blade.php`
     * má inline `<style>`). V skriptoch je to ale presne to, čo by zrušilo obranu
     * `public/js/shared/markdown.js` — dve z troch plôch kreslia výstup modelu.
     */
    public function test_scripts_never_allow_unsafe_inline(): void
    {
        foreach (self::SURFACES as $uri) {
            $policy = $this->policyOf($uri);

            preg_match("/script-src ([^;]+)/", $policy, $m);
            $this->assertStringNotContainsString(
                'unsafe-inline',
                $m[1] ?? '',
                "Plocha {$uri}: `script-src` povoľuje inline skripty."
            );
            $this->assertStringNotContainsString('unsafe-eval', $m[1] ?? '', "Plocha {$uri}");
        }
    }

    /**
     * Blade nesmie ťahať skript z cudzieho hosta.
     *
     * Hlavička hovorí, čo prehliadač POVOLÍ; toto hovorí, čo appka naozaj
     * ŽIADA. Bez druhej polovice by pridaný CDN tag prešel testami a prejavil sa
     * až rozbitou plochou (po vynútení politiky) alebo violáciou v konzole.
     */
    public function test_no_blade_loads_a_script_from_a_foreign_host(): void
    {
        $offenders = [];

        foreach (glob(resource_path('views/*.blade.php')) as $file) {
            $body = (string) file_get_contents($file);

            // Komentáre blade (`{{-- … --}}`) sa vyhodia: história CDN je v nich
            // zámerne popísaná a nie je to načítanie.
            $body = preg_replace('/\{\{--.*?--\}\}/s', '', $body) ?? $body;

            if (preg_match('/<script[^>]+src\s*=\s*["\']https?:/i', $body) === 1) {
                $offenders[] = basename($file);
            }
        }

        $this->assertSame(
            [],
            $offenders,
            'Blade ťahá skript z cudzieho hosta: '.implode(', ', $offenders)
            .'. Self-hostuj ho do public/js/vendor/ (postup je v jeho README).'
        );
    }
}
