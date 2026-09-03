{{-- Ikony značky pre kartu prehliadača a dlaždicu OS — JEDNA pravda pre všetky
     plochy (`/`, `/console`, `/chat`). Do 1. 9. 2026 tu boli tri bit-identické
     kópie v troch `<head>`och a tri kópie komentára, ktorý vysvetľoval, že sa
     musia prepisovať naraz. Kópia, ktorá sa musí prepisovať naraz, je jedna
     pravda napísaná trikrát.

     Riadok `<link rel="icon">` PREPISUJE GENERÁTOR `tools/brand/build-mark.py`
     (funkcia `patch_icon_partial`) — needituj ho ručne, prepíše sa. Zdroj
     geometrie je `public/brand/hades-sigil-mini.svg`, zdroj papiera `--bg-rgb`
     tmavej témy v `public/css/mind.css`. Generátor si zároveň overuje, že žiadna
     page blade nemá vlastnú kópiu tohto riadka; keby ju mala, padne.

     Tri hodnoty palety sú v data-URI zapísané NATVRDO, pretože data-URI je
     samostatný dokument a CSS premenné z `mind.css` nečíta:
       %230e1413 = --bg-rgb tmavej témy (papier, pozadie znaku),
       %23c4a2f5 = --accent tmavej témy (amethyst, prstenec),
       %23d8b878 = --brand-gold (jadro vedomia).
     Tmavá vetva palety je zámer: karta prehliadača aj dlaždica OS sú tmavé.
     Predtým to bol zlatý disk s tenkým prstencom na 40 % alfy — pri 16 px
     prstenec zmizol a v karte ostala len zlatá škvrna bez identity. --}}
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='50' fill='%230e1413'/><circle cx='50' cy='50' r='36' fill='none' stroke='%23c4a2f5' stroke-width='9'/><circle cx='50' cy='50' r='15' fill='%23d8b878'/></svg>">
{{-- Fallback pre prehliadače, ktoré SVG favicon neberú, a dlaždica pre iOS.
     .ico je vyrobené z MINI verzie znaku — master by sa pri 16 px zlial. --}}
<link rel="alternate icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
{{-- Lišta prehliadača na mobile. DVE deklarácie, nie jedna: `theme-color` nemá
     nič ako CSS premennú, takže papier oboch tém musí stáť tu natvrdo —
       #f8f4f7 = --bg-rgb svetlej témy (`mind.css` :root),
       #0e1413 = --bg-rgb tmavej témy (`:root[data-theme="dark"]`).
     Tu sa vetví podľa `prefers-color-scheme`, teda podľa systému, kým appka si
     tému pamätá v `data-theme` (default TMAVÁ, `initialTheme()` v `theme.js`).
     Sú to dva rôzne signály a zladiť ich sa nedá — `theme-color` je metadáta
     dokumentu, ktoré prehliadač čítal už pred spustením JS. Preto nie je toto
     miesto, kde by sa mal default témy appky duplikovať; ikony vedľa idú
     zámerne tmavou vetvou (karta a dlaždica sú tmavé), lišta ide systémom. --}}
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f8f4f7">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0e1413">
{{-- Manifest je pod `public/`, teda VEREJNÝ — `auth.ui` naň nedosiahne a appka
     je tunelovaná cez ngrok. Preto nesie LEN názov, ikony a farby; žiadne
     `start_url` (spec ho odvodí z dokumentu, ktorý manifest odkázal), žiadny
     `scope`, žiadny popis. Každý kľúč navyše je verejná informácia o štruktúre
     appky. `manifest-src` v CSP nie je a nemá byť: `default-src 'self'` ho
     pokrýva (viď docblock `ContentSecurityPolicy`). --}}
<link rel="manifest" href="/manifest.json">
