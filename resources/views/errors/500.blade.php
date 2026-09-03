{{--
    500 — chyba servera.

    Predmet je vlastný a stránka NEPREDSTIERA, že s tým človek niečo urobí: nedáva
    „Skúsiť znovu", pretože ten istý request skončí rovnako, a nedáva pokyn typu
    „skontroluj vstup", pretože vstup nie je príčina. Jediná akcia je cesta VON.

    Zámerne neprezrádza nič o príčine: žiadny `$exception->getMessage()`, žiadna
    cesta k logu, žiadny názov triedy. Appka je verejne tunelovaná cez ngrok, takže
    túto stránku vidí aj cudzí človek, a stack trace či cesta v `storage/` je preň
    informácia o stroji, nie pomoc. Vlastník appky si trace prečíta v logu, ktorý
    Laravel zapísal skôr, než sa táto stránka vydala.

    PRI `APP_DEBUG=true` TÚTO STRÁNKU NEVIDNO — Laravel vtedy vydá svoju debug
    stránku s trace. Overuje sa preto priamym vyrenderovaním šablóny
    (`view('errors.500')->render()`), nie vyvolaním chyby v prehliadači.
--}}
@extends('errors.layout')

@section('title', 'Hades — chyba servera')
@section('subject', 'Vedomie neodpovedalo')

@section('body')
    <p>Hades sa pri tomto dopyte zasekol na svojej strane. Zapísal si to a ty s tým
        teraz neurobíš nič — nie je to tvoja chyba ani tvoje nastavenie.</p>
    <p><a class="act" href="{{ url('/') }}">Späť na Graf</a></p>
@endsection
