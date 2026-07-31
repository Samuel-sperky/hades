{{-- Vlastník: A5 (P9 — shell).
     Nástroje grafu (#graph-tools, #view-switch) sú vlastnené A4 a vkladajú sa
     ako samostatný partial — A5 určuje len ich miesto v layoute. --}}
<header id="app-header">
    {{-- WCAG 2.4.1 (Bypass Blocks): rail má 15 tabulátorových zastávok, bez tohto
         odkazu sa klávesnicou k obsahu nedá dostať skratkou. Odkaz je prvým dieťaťom
         hlavičky, teda hneď za plátnom (app.blade.php má canvas pred hlavičkou —
         to je zdieľaný súbor, poradie nemením). Viditeľný je len pri fokuse. --}}
    <a id="skip-to-main" class="skip-link" href="#screens">Preskočiť na obsah</a>
    <div class="h-left">
        <span id="brand-name">AuraAI</span>
        <nav id="breadcrumb" aria-label="Aktuálny kontext"></nav>
        <span id="status-chip" aria-live="polite"><span class="dot" aria-hidden="true"></span><span class="txt">spí</span></span>
    </div>
    <div class="h-center">
        @include('partials.graph-tools')
        <div id="header-metrics" aria-live="polite"></div>
    </div>
    <div class="h-right">
        <button id="pack-trigger" type="button" class="hidden" aria-label="Balík pre Claude Code">
            <span class="ms" aria-hidden="true">inventory_2</span>
            <span id="pack-count">0</span>
        </button>
        <button id="cmdk-trigger" type="button" aria-label="Hľadať (Ctrl+K)">
            <span class="ms" aria-hidden="true">search</span>
            <span class="cmdk-hint">Hľadať</span>
            <kbd>Ctrl K</kbd>
        </button>
    </div>
</header>
