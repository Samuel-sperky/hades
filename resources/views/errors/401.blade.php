{{--
    Zamknutý Hades. Vidno ju len na HTML ceste (`/`) — /api/* a /mcp vracajú JSON
    (shouldRenderJsonWhen v bootstrap/app.php). Zámerne neprezrádza nič o stave
    vedomia ani o dôvode odmietnutia nad rámec toho, čo už vie ten, kto token má.

    Kresba (znak, tichá verzia, typografia, favicon) je v `errors/layout.blade.php` —
    do 3. 9. 2026 ju tento súbor niesol sám a bol jediná chybová stránka appky. Keď
    značku dostali aj 404/419/500/503, výkres sa presunul do plášťa, aby nevznikli
    štyri ďalšie kópie tých istých 90 riadkov. Tento súbor je teda len predmet, veta
    a jedna akcia; správanie stránky sa tým nezmenilo.

    Táto stránka je zároveň dôvod, prečo politika CSP nesie `style-src 'unsafe-inline'`
    (inline `<style>` blok plášťa) — testuje ju `tests/Feature/ContentSecurityPolicyTest.php`.
--}}
@extends('errors.layout')

@section('title', 'Hades — zamknuté')
@section('subject', 'Hades je zamknutý')

@section('body')
    <p>Vedomie beží, ale toto okno nie je odomknuté. Odomkni ho raz tokenom
        z <code>HADES_UI_TOKEN</code> — ďalej si to už session pamätá.</p>
    {{-- Jediná „akcia" tejto stránky je tvar adresy, nie odkaz: odkaz by musel niesť
         token v URL, a ten by skončil v histórii prehliadača aj v access logu. --}}
    <p><code>/?token=&lt;HADES_UI_TOKEN&gt;</code></p>
@endsection
