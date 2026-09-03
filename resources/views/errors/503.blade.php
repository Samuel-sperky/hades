{{--
    503 — údržba (`php artisan down`, resp. `PreventRequestsDuringMaintenance`).

    Predmet je vlastný a je to jediná z tejto štvorice, kde „skúsiť znova" NIE JE
    predstieranie: odstávka je stav, ktorý sám prejde, takže opakovanie požiadavky
    je naozaj cesta ďalej. Odkaz preto vedie na `/` — počas odstávky vydá znova túto
    istú stránku a po jej konci Graf, čo je presne to, čo má akcia sľubovať.

    Nepíše, DOKEDY: `Retry-After` appka nenastavuje a odhad, ktorý sa nedodrží, je
    horší než žiadny.
--}}
@extends('errors.layout')

@section('title', 'Hades — údržba')
@section('subject', 'Vedomie je na chvíľu odstavené')

@section('body')
    <p>Prebieha údržba. Pamäť je celá, len teraz neprijíma dopyty — za chvíľu bude
        Hades znova hore.</p>
    <p><a class="act" href="{{ url('/') }}">Skúsiť znova</a></p>
@endsection
