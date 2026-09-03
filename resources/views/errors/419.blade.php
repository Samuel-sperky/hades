{{--
    419 — vypršala session (Laravel: `TokenMismatchException`, teda staré CSRF
    potvrdenie na otvorenej stránke).

    Cesta ďalej je NAČÍTAŤ STRÁNKU ZNOVA: nové potvrdenie sa vydá pri načítaní samo,
    človek nemá čo opravovať. Preto je jedna akcia odkaz, ktorý to načítanie urobí.

    Odkaz vedie na `/`, NIE na `url()->previous()`. Dôvod: pri vypršanej session je
    predchádzajúca adresa už len hlavička `Referer`, teda vstup zvonka — a tá by sa
    tu vypisovala do `href` na stránke, ktorú vie vyvolať kdokoľvek. Ta istá vec je
    zapísaná aj o vstupoch do `ContextBlock`: keď sa dá vziať hodnota zo servera,
    nebrať ju z prehliadača.

    Na tejto appke je 419 na HTML ceste vzácne — POSTy z prehliadača idú na `/api/*`
    a tam odpoveď je JSON (shouldRenderJsonWhen v bootstrap/app.php). Stránka teda
    kryje ručne odoslaný formulár a starú otvorenú kartu, nie bežný beh.
--}}
@extends('errors.layout')

@section('title', 'Hades — vypršala session')
@section('subject', 'Session vypršala')

@section('body')
    <p>Stránka bola otvorená dlho a jej potvrdenie už neplatí. Nič sa nestratilo —
        pri načítaní vydá vedomie nové a môžeš to poslať znova.</p>
    <p><a class="act" href="{{ url('/') }}">Načítať Hades znova</a></p>
@endsection
