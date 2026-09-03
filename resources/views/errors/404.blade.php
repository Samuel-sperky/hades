{{--
    404 — adresa v pamäti nie je.

    Do 3. 9. 2026 tu nebolo nič a Laravel vydával svoju vlastnú stránku: anglické
    „Not Found", bez znaku, bez hlasu appky. Appka je verejne tunelovaná cez ngrok,
    takže tú stránku vidí aj cudzí človek.

    Predmet je VLASTNÝ, nie „Nastala chyba" (manuál §8). 404 je jediná chyba z tejto
    štvorice, ktorú spôsobil odkaz alebo preklep, nie appka — preto hovorí o adrese,
    nie o poruche, a jej jedna akcia vedie tam, kde adresy platia.

    Zámerne NEPÍŠE, ktorá adresa chýba: `{{ $exception->getMessage() }}` by na 404
    z routera bol prázdny, a keď nie je, nesie text z kódu appky, nie z URL.
--}}
@extends('errors.layout')

@section('title', 'Hades — adresa neexistuje')
@section('subject', 'Túto adresu vedomie nemá')

@section('body')
    <p>Odkaz vedie na miesto, ktoré v Hadesovi nie je — alebo tam už nie je.
        Pamäť je v poriadku, len tento vchod nie.</p>
    <p><a class="act" href="{{ url('/') }}">Späť na Graf</a></p>
@endsection
