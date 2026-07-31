{{--
    AuraAI — koreňová šablóna.

    ZDIEĽANÝ SÚBOR — mení ho LEN koordinátor / integrátor.

    Tento súbor je zámerne len zoznam @include. Každý partial má práve jedného
    vlastníka (tabuľka v CLAUDE.md §4) a stabilné id / data-* atribúty, na ktoré
    sa cudzie moduly pripájajú bez toho, aby partial otvorili.

    PORADIE @include JE DOM PORADIE a je súčasťou kontraktu: canvas musí byť prvý
    (leží pod celým shellom), overlaye posledné (z-index kaskáda). Presunutie
    includu mení vykreslenie — nerobí sa bez integrátora.
--}}
<!DOCTYPE html>
<html lang="sk">
@include('partials.head')
<body>
    @include('partials.canvas')

    @include('partials.header')
    @include('partials.rail')
    @include('partials.mode-switch')

    <main id="screens">
        @include('partials.screens.dnes')
        @include('partials.screens.dennik')
        @include('partials.screens.kniznica')
        @include('partials.screens.chat')
        @include('partials.screens.eshop')
        @include('partials.screens.rozhodnutia')
        @include('partials.screens.kontrola')
        @include('partials.screens.smernica')
        @include('partials.screens.agenti')
    </main>

    @include('partials.dock')
    @include('partials.node-panel')
    @include('partials.pack-drawer')

    @include('partials.zoomctl')
    @include('partials.chat-quickbar')
    @include('partials.chat-overlay')

    @include('partials.toasts')
    @include('partials.hover-card')

    @include('partials.cmdk')
    @include('partials.help-overlay')
    @include('partials.md-overlay')
    @include('partials.hint')

    @include('partials.mobile-nav')
</body>
</html>
