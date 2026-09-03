#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Jeden generátor znaku Hades — jeden zdroj geometrie, sedem výstupov.

ŽIJE MIMO `public/` a je to bezpečnostné rozhodnutie, nie estetika: všetko pod
`public/` servuje web server priamo a `auth.ui` na to nemá dosah (zmerané
28. 8. 2026: `/` dáva 401, ale `/brand/build-mark.py` dávalo 200 bez tokenu).
Appka je tunelovaná cez ngrok, takže web root je verejný. Build skript nie je
asset.

    python tools/brand/build-mark.py             # prepíše výstupy
    python tools/brand/build-mark.py --dry-run   # len vypíše odvodené hodnoty

PREČO to existuje: geometria znaku bola 27. 8. 2026 zapísaná 16× v repe a dvakrát
ako binárka bez zdroja (`public/favicon.ico`, `electron/assets/hades.ico`). Každý
taký zápis je miesto, kde znak môže tichom driftnúť — a `.load-mark` v mind.css už
driftol (prstenec 0,46 boxu proti kánonickým 0,36). Generátor to nezlieva do
jedného tvaru; zlieva to do jedného ZDROJA a rozdiely medzi výskytmi robí
vypočítanými, nie ručnými.

ZDROJE (jediné miesta, kde sa geometria a farby znaku píšu rukou):
  * public/js/shared/sigil.js          — KÁNON SIETE: tabuľka `SIGIL_NET` vo viewBoxe
    24 (jadro, tri satelity, štyri hrany). Generátor ju PARSUJE, nekopíruje.
  * public/brand/hades-sigil-mini.svg  — KÁNON JEDNÉHO UZLA: prstenec r36/hrúbka 9,
    zlatý stred r15
  * public/css/mind.css                — tmavý papier (`--bg-rgb`) pod faviconom

ZNAK JE OD 1. 9. 2026 SIEŤ (rozhodnutie používateľa): jadrový uzol a tri vedľajšie,
viazané štyrmi hranami. Prstencový znak „Jedno oko" (nosný prstenec, prerušenie,
satelit, obežnica, delenia po 30°) je retirovaný a jeho slovník sa NEPREKLÁDA.

GEOMETRIU SIETE VLASTNÍ APPKA, NIE TENTO GENERÁTOR (rozhodnutie používateľa
2. 9. 2026). Vlna, ktorá znak prekresľovala, bežala v dvoch rukách naraz a každá
nakreslila vlastný výsek: appka `SIGIL_NET` vo viewBoxe 24, kánon vlastné polárne
`NET_SATS` v boxe 100 — a jadro mali rôzne (appka plný zlatý kotúč, kánon amethystový
prstenec so zlatým stredom). Vyhrala APPKA a dôvod je kánon celého projektu: prstenec
okolo jadra by z jadra urobil ŠTVRTÝ prstencový uzol a „jadro = jediný sýty plný
prvok" by prestalo platiť. Generátor si preto `SIGIL_NET` **prečíta zo sigil.js**,
tak ako si mini pomery číta z mini SVG — kopírovanie tabuľky do Pythonu by bola tretia
kópia tej istej pravdy a driftla by rovnako ako predtým `NET_SATS`.

IDENTITA JE V POMEROCH, NIE V ABSOLÚTNYCH HODNOTÁCH. `SIGIL_NET` žije vo viewBoxe 24,
master a rastre v boxe mini (100), Electron offline v 100 — všetko sú tie isté čísla
prenásobené `box / 24`. `assert_same_cutout()` to po každom behu premeria: pomer každej
súradnice k boxu musí sedieť s appkou do 1e-9. Absolútnu identitu by v sieti udržať
nešlo (jadro s prstencom r 36 nenechá satelitom miesto), pomerovú áno a je overiteľná.

REBRÍK REDUKCIE je súčasť znaku, nie jeho dokumentácia: pod NET_MIN_PX (32) sa hrany
scvrknú na 3,5 px stuble a znak prestane hovoriť „sieť", takže sa kreslí MINI — jeden
uzol. `ladder()` to prepočítava z geometrie a vypisuje do DERIVED.md aj s kalibráciou
opačným smerom (koľko by sieť merala, keby sa na tom stupni kreslila). Prah je ten
istý, aký nesie appka, a je STUBLOVÝ, nie obrysový — 32 px riadok preto obrysovú
podlahu 1,5 px o 0,03 px NESPLNÍ a tabuľka to priznáva.

VÝSTUPY:
  1. public/brand/hades-sigil.svg           (master = sieť)
  1b. public/brand/hades-sigil-mono.svg     (master jednofarebne)
  1c. public/brand/hades-lockup-h/-v.svg    (znak + wordmark; wordmark sa nehýbe)
  2. public/brand/hades-favicon.svg         (mini na atramentovom disku — zdroj data-URI)
  3. public/brand/apple-touch-icon.png      (180 px, tá istá kompozícia)
  4. public/favicon.ico + electron/assets/hades.ico  (16/24/32/48/64/128/256)
  5. <link rel="icon"> data-URI v resources/views/partials/brand-icons.blade.php
     (jeden cieľ; tri page blade si ho `@include`ujú — do 1. 9. 2026 to boli tri
     bit-identické kópie v troch `<head>`och a generátor patchoval každú zvlášť)
  6. znak v electron/chrome/topbar.html a electron/states/offline.html (medzi ZNAK markermi)
  7. tools/brand/DERIVED.md — odvodené čísla pre CSS a Blade, ktoré tento generátor
     nevlastní (`stroke-dasharray`, tri čísla `.load-mark`, inline blok viewBox 24,
     rebrík redukcie a inline SIEŤ s dĺžkami hrán pre `stroke-dasharray`)

Kánon akcentu (BRAND-HADES §6): ZLATÁ je značková a patrí jadru — na plátne aj
v znaku je jadro jediný sýty plný prvok. AMETHYST je interaktívny. Znak je značkový,
takže zlatá je tu správna; interaktívny stav z nej robiť nesmieme, preto generátor
farby len prenáša zo zdroja a žiadnu novú rolu im nedáva.

Determinizmus je súčasť kontraktu: dva behy nad nezmeneným zdrojom musia dať bajt
na bajt tie isté výstupy. Bez toho sa nedá poznať, či generátor beží, alebo sa len
prepísal súbor.
"""
from __future__ import annotations

import io
import math
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
BRAND = ROOT / "public" / "brand"
# DERIVED.md je vývojárska dokumentácia, nie asset — žije pri generátore
# a NIE v web roote (viď bezpečnostná poznámka v hlavičke).
TOOLS = ROOT / "tools" / "brand"

MINI_SRC = BRAND / "hades-sigil-mini.svg"
MASTER_SRC = BRAND / "hades-sigil.svg"
MIND_CSS = ROOT / "public" / "css" / "mind.css"
# Kánon siete. Generátor ho ČÍTA a nevlastní — vlastníkom je appka (`shared/sigil.js`
# kreslí `/`, `/console` aj `/chat`). Zápis do tohto súboru generátorom by bol presne
# ten obojsmerný drift, kvôli ktorému sa geometria minule rozdvojila.
SIGIL_JS = ROOT / "public" / "js" / "shared" / "sigil.js"

VIEWS = ROOT / "resources" / "views"

# Ikony značky majú od 1. 9. 2026 JEDEN cieľ — Blade partial, ktorý si tri page
# blade `@include`ujú. Dovtedy tu bol zoznam troch blade a generátor prepisoval
# jeden riadok v každom; boli bit-identické, takže to bola jedna pravda napísaná
# trikrát, aj s trojitou kópiou komentára „keď sa paleta zmení, prepíš to ručne".
ICONS_PARTIAL = VIEWS / "partials" / "brand-icons.blade.php"

# Stráž proti tichému návratu tretej kópie: page blade nesmie mať vlastný
# `<link rel="icon">`. Keby ho mala, generátor by prepísal partial a plocha by
# ostala v starých farbách — presne ten drift, kvôli ktorému partial vznikol.
# `errors/401.blade.php` v zozname NIE JE zámerne: nesie iný výkres (zlatý disk
# s prstencom na 40 % alfy), teda nie kópiu tejto pravdy, a nikto ho negeneruje.
PAGE_BLADES = [
    VIEWS / "mind.blade.php",
    VIEWS / "console.blade.php",
    VIEWS / "chat.blade.php",
]

ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
SUPERSAMPLE = 4          # 4× nadvzorkovanie + LANCZOS = čistá hrana na 16 px
APPLE_TOUCH_PX = 180

# Box načítavacej značky (`.load-mark`). 32 px, a je to ZMERANÁ hodnota z appky
# (`offsetWidth`), nie voľba generátora: nosič vyrástol z 26 na 32 px práve preto,
# aby smel niesť SIEŤ — pod prahom NET_MIN_PX by z neho bol jeden uzol, teda
# generický spinner. Generátor sem už nič neodvodzuje: `.load-mark` prestal byť CSS
# `border` a je to inline `<svg>` z `sigilNetMarkup()`.
LOAD_MARK_BOX_PX = 32

BLADE_VIEWBOX = 24            # inline znak v Blade beží na mriežke ikon


# --------------------------------------------------------------------------- #
# Čítanie zdrojov
# --------------------------------------------------------------------------- #

def read(path: Path) -> str:
    """Číta BEZ prekladu koncov riadkov (`newline=""`).

    PREČO: `console.blade.php` má CRLF, ostatné dva blade a oba electron dokumenty
    LF. Univerzálne konce riadkov by pri zápise prepísali celý súbor na LF — teda
    generátor, ktorý smie zmeniť jediný riadok, by hlásil diff cez celý `<head>`
    aj cez regióny, ktoré vlastní niekto iný. Zmerané: 179 CRLF v console.blade.
    """
    return path.read_text(encoding="utf-8", newline="")


def newline_of(text: str) -> str:
    """Dominantný konec riadka súboru — vložený blok ho musí zdediť."""
    return "\r\n" if text.count("\r\n") * 2 > text.count("\n") else "\n"


def num(value: float) -> str:
    """Číslo do SVG/CSS: bez zbytočnej nuly za desatinnou čiarkou."""
    rounded = round(value, 2)
    if abs(rounded - round(rounded)) < 1e-9:
        return str(int(round(rounded)))
    return f"{rounded:g}"


class Mini:
    """Kánon mini znaku, vyparsovaný z hades-sigil-mini.svg.

    Parsujeme, nie kopírujeme: keby sa v zdroji zmenil polomer, všetkých sedem
    výstupov sa zmení jedným behom. Keď zdroj nesedí s očakávaným tvarom (dva
    kruhy: prstenec + jadro), padáme nahlas — tichý fallback by vydal iný znak.
    """

    def __init__(self, svg: str) -> None:
        vb = re.search(r'viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"', svg)
        if not vb or vb.group(1) != vb.group(2):
            raise SystemExit("mini: chýba štvorcový viewBox")
        self.box = float(vb.group(1))

        circles = re.findall(r"<circle\b([^/>]*)/?>", svg)
        if len(circles) != 2:
            raise SystemExit(f"mini: očakávam 2 kruhy (prstenec + jadro), našiel {len(circles)}")

        def attr(chunk: str, name: str) -> str | None:
            m = re.search(rf'\b{name}="([^"]+)"', chunk)
            return m.group(1) if m else None

        ring, core = circles
        self.cx = float(attr(ring, "cx"))
        self.cy = float(attr(ring, "cy"))
        self.ring_r = float(attr(ring, "r"))
        self.ring_w = float(attr(ring, "stroke-width"))
        self.core_r = float(attr(core, "r"))
        if attr(core, "fill") in (None, "none"):
            raise SystemExit("mini: jadro musí byť PLNÉ — je to jediný sýty prvok znaku")

        # Farby: mini nesie obe témy v <style>. Berieme TMAVÚ, pretože favicon aj
        # dlaždica sedia na tmavom chróme prehliadača/OS a zlaté jadro tam čítať je.
        self.acc_dark = self._var(svg, "acc", dark=True)
        self.gold_dark = self._var(svg, "gold", dark=True)
        self.acc_light = self._var(svg, "acc", dark=False)
        self.gold_light = self._var(svg, "gold", dark=False)

    @staticmethod
    def _var(svg: str, name: str, dark: bool) -> str:
        block = svg
        if dark:
            m = re.search(r"prefers-color-scheme:\s*dark\s*\)\s*\{(.*?)\}\s*\}", svg, re.S)
            if not m:
                raise SystemExit("mini: chýba tmavá vetva palety")
            block = m.group(1)
        m = re.search(rf"--{name}:\s*(#[0-9a-fA-F]{{6}})", block)
        if not m:
            raise SystemExit(f"mini: chýba --{name}")
        return m.group(1).lower()

    # ---- odvodené hodnoty ------------------------------------------------- #

    @property
    def disk_r(self) -> float:
        """Atramentový disk faviconu: dosadá na hranu štvorca, rohy zostávajú
        priehľadné (tak to má dnešný favicon aj apple-touch-icon)."""
        return self.box / 2

    @property
    def ring_ratio(self) -> float:
        return self.ring_r / self.box

    @property
    def stroke_ratio(self) -> float:
        return self.ring_w / self.box

    @property
    def core_diameter_ratio(self) -> float:
        return 2 * self.core_r / self.box


def dark_paper_hex() -> str:
    """Tmavý papier z mind.css (`--bg-rgb` v tmavej téme).

    Nekopírujeme hodnotu: favicon sedí na tom istom papieri ako appka a keby sa
    rozišli, ikona v karte prehliadača by hlásila inú tmu než plocha za ňou.
    """
    css = read(MIND_CSS)
    dark = re.search(r'\[data-theme="dark"\]\s*\{(.*?)\n\}', css, re.S)
    if not dark:
        raise SystemExit("mind.css: nenašiel som blok tmavej témy")
    m = re.search(r"--bg-rgb:\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)", dark.group(1))
    if not m:
        raise SystemExit("mind.css: v tmavej téme chýba --bg-rgb (papier pod faviconom)")
    r, g, b = (int(x) for x in m.groups())
    return f"#{r:02x}{g:02x}{b:02x}"


# --------------------------------------------------------------------------- #
# Zápis len pri zmene (aby `git status` hovoril pravdu o tom, čo beh urobil)
# --------------------------------------------------------------------------- #

WRITTEN: list[str] = []
UNCHANGED: list[str] = []
DRY = "--dry-run" in sys.argv


def emit(path: Path, data: bytes | str) -> None:
    payload = data.encode("utf-8") if isinstance(data, str) else data
    rel = path.relative_to(ROOT).as_posix()
    old = path.read_bytes() if path.exists() else None
    if old == payload:
        UNCHANGED.append(rel)
        return
    if not DRY:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
    WRITTEN.append(rel)


# --------------------------------------------------------------------------- #
# 1. mono master
# --------------------------------------------------------------------------- #

MONO_HEAD = """    /* monochróm: jedna farba, dedí sa cez currentColor (tlač, razítko, jednofarebné
       podklady). Jadro tu nesie plnú výplň — hierarchia zostáva, aj keď farba zmizne. */
    svg { --acc: currentColor; --gold: currentColor; }"""


def build_mono(master: str) -> str:
    """Master jednofarebne: to isté telo, vymenená len paleta v <style>.

    Kresba sa NEPREPISUJE — mono je master s jednou farbou, takže sa musí meniť
    s ním v tom istom behu. Preto sa berie doslova a zasahuje sa len do palety.
    """
    m = re.search(r"(  <style>\r?\n)(.*?)(  </style>\r?\n)", master, re.S)
    if not m:
        raise SystemExit("master: nenašiel som blok <style>")
    nl = newline_of(master)
    body_lines = [
        ln for ln in m.group(2).splitlines(keepends=True)
        if not re.match(r"\s*(svg \{ --acc|@media \(prefers-color-scheme)", ln)
    ]
    head = MONO_HEAD.replace("\n", nl)
    style = m.group(1) + head + nl + "".join(body_lines) + m.group(3)
    return master[:m.start()] + style + master[m.end():]


# --------------------------------------------------------------------------- #
# 2.–3. favicon SVG a data-URI
# --------------------------------------------------------------------------- #

def favicon_svg(mini: Mini, ink: str) -> str:
    """Mini znak na atramentovom disku — kompozícia faviconu ako skutočný súbor.

    Existuje preto, aby data-URI v Blade nebol jediným nositeľom tejto kompozície:
    data-URI sa nedá otvoriť v editore ani skontrolovať okom.
    """
    c, vb = num(mini.cx), num(mini.box)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vb} {vb}" role="img" aria-label="Hades">\n'
        "  <title>Hades</title>\n"
        "  <!-- GENEROVANÉ tools/brand/build-mark.py — needituj ručne.\n"
        "       Kompozícia faviconu: atramentový disk (papier tmavej témy) + kánon mini.\n"
        "       Tmavá vetva palety zámerne: karta prehliadača a dlaždica OS sú tmavé. -->\n"
        f'  <circle cx="{c}" cy="{c}" r="{num(mini.disk_r)}" fill="{ink}"/>\n'
        f'  <circle cx="{c}" cy="{c}" r="{num(mini.ring_r)}" fill="none" '
        f'stroke="{mini.acc_dark}" stroke-width="{num(mini.ring_w)}"/>\n'
        f'  <circle cx="{c}" cy="{c}" r="{num(mini.core_r)}" fill="{mini.gold_dark}"/>\n'
        "</svg>\n"
    )


def favicon_data_uri(mini: Mini, ink: str) -> str:
    """Ten istý znak ako data-URI. Jednoduché apostrofy a %23 sú povinné:
    v HTML atribúte `href="..."` sú dvojité apostrofy koniec atribútu a `#`
    by odsekol zvyšok do fragmentu."""
    c, vb = num(mini.cx), num(mini.box)

    def h(color: str) -> str:
        return "%23" + color.lstrip("#")

    return (
        "data:image/svg+xml,"
        f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {vb} {vb}'>"
        f"<circle cx='{c}' cy='{c}' r='{num(mini.disk_r)}' fill='{h(ink)}'/>"
        f"<circle cx='{c}' cy='{c}' r='{num(mini.ring_r)}' fill='none' "
        f"stroke='{h(mini.acc_dark)}' stroke-width='{num(mini.ring_w)}'/>"
        f"<circle cx='{c}' cy='{c}' r='{num(mini.core_r)}' fill='{h(mini.gold_dark)}'/>"
        "</svg>"
    )


# Bez koncovej zátvory `$`: v CRLF súbore je pred koncom riadka `\r` a anker by
# nesedel — regex by nenašiel nič a generátor by padol. Odsadenie je `[ \t]*`,
# nie `\s*`: `\s` berie aj nový riadok, teda by match začal na predchádzajúcom
# riadku a `emit` by zapísal o riadok menej.
ICON_LINK_RE = re.compile(r'(?m)^([ \t]*<link rel="icon" href=")([^"]*)(">)')


def patch_icon_partial(uri: str) -> None:
    """Prepíše LEN riadok <link rel="icon"> v Blade partiale ikon.

    Vlastníctvo v tomto behu je po súboroch a v blade po regiónoch: tento
    generátor smie do blade zapísať jediný riadok. Preto regex, nie šablóna —
    šablóna by prepísala celý súbor vrátane komentára, ktorý generátor nevlastní.

    Cieľ je jeden, nie tri. Zvyšok partialu (`alternate icon`, `apple-touch-icon`)
    je ručný a generátor sa ho nedotkne.
    """
    src = read(ICONS_PARTIAL)
    if not ICON_LINK_RE.search(src):
        raise SystemExit(
            f"{ICONS_PARTIAL.name}: nenašiel som riadok <link rel=\"icon\">")
    emit(ICONS_PARTIAL, ICON_LINK_RE.sub(
        lambda m: m.group(1) + uri + m.group(3), src, count=1))


def assert_partial_is_only_truth() -> None:
    """Page blade nesmie mať vlastný `<link rel="icon">` — musí ísť cez partial.

    Bez tejto stráže sa dá tretia kópia vrátiť tichom: generátor by prepísal
    partial, plocha by ostala v starých farbách a nič by nepadlo. Kontrola je
    tu preto, že práve tak driftol znak predtým, než mal generátora.
    """
    strays = []
    for blade in PAGE_BLADES:
        src = read(blade)
        if ICON_LINK_RE.search(src):
            strays.append(blade.name)
        if "partials.brand-icons" not in src:
            raise SystemExit(
                f"{blade.name}: chýba @include('partials.brand-icons') — "
                "plocha by bola bez ikon značky")
    if strays:
        raise SystemExit(
            "vlastný <link rel=\"icon\"> v page blade: " + ", ".join(strays)
            + " — patrí do resources/views/partials/brand-icons.blade.php")


# --------------------------------------------------------------------------- #
# 4. rastre: .ico a apple-touch-icon
# --------------------------------------------------------------------------- #

def raster(mini: Mini, ink: str, px: int) -> Image.Image:
    """Znak ako raster, na správnom stupni redukcie pre danú veľkosť.

    Prstenec (uzol) sa kreslí ako ANULUS (plný disk r+w/2 a do neho atramentový
    disk r-w/2), nie ako `ellipse(width=)`: PIL kreslí obrys s celočíselnou
    šírkou a na 16 px by 9/100 hrúbky spadlo na 1 px alebo 2 px podľa
    zaokrúhlenia, teda znak by na každej veľkosti vážil inak.

    STUPEŇ ROZHODUJE `NET_MIN_PX`, nie volajúci: pod ním sa kreslí mini (jeden
    uzol), nad ním celá sieť. Preto `.ico` obsahuje DVA rôzne výkresy — a je to
    presne to, na čo multi-size `.ico` je. Keby sa sieť kreslila aj na 16 px,
    z hrán by bolo vidno 2,60 / 2,40 / 2,33 px stubla (viď `ladder()`).

    Diskový stupeň (uzly plné, obrys zahodený) tu do 2. 9. 2026 bol a je
    retirovaný spolu so starou geometriou: `SIGIL_NET` má obrysy 2,5× hrubšie
    voči boxu, takže prstence držia až po prah siete a ústupok nemá dôvod.
    """
    n = px * SUPERSAMPLE
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = n / mini.box

    def disc(x: float, y: float, r: float, color: str) -> None:
        d.ellipse([x * s - r * s, y * s - r * s, x * s + r * s, y * s + r * s], fill=color)

    disc(mini.cx, mini.cy, mini.disk_r, ink)

    if px < NET_MIN_PX:
        disc(mini.cx, mini.cy, mini.ring_r + mini.ring_w / 2, mini.acc_dark)
        disc(mini.cx, mini.cy, mini.ring_r - mini.ring_w / 2, ink)
        disc(mini.cx, mini.cy, mini.core_r, mini.gold_dark)
        return img.resize((px, px), Image.LANCZOS)

    geo = net_geometry(mini)
    # Hrany pred uzlami — to isté poradie ako v SVG. Konce hrán sú TÁ ISTÁ
    # geometria (`net_geometry`), nie „nechám to prekryť atramentom": prekrytie by
    # dalo iný tvar spoja než SVG a dva výstupy jedného znaku by sa rozišli.
    # Priehľadnosť hrán (.8 / .5) ide cez samostatnú vrstvu a alpha kompozíciu,
    # nie cez `fill` s alfou priamo do obrázka: `ImageDraw` alfu NEMIEŠA, len ju
    # zapíše, takže hrana by na atramentovom disku vyrezala poloprehľadnú dieru.
    layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    rgb = tuple(int(mini.acc_dark[i:i + 2], 16) for i in (1, 3, 5))
    for e in geo["edges"]:
        ld.line([e["x1"] * s, e["y1"] * s, e["x2"] * s, e["y2"] * s],
                fill=rgb + (round(255 * (0.5 if e["lat"] else 0.8)),),
                width=max(1, round(geo["edge_w"] * s)))
    img = Image.alpha_composite(img, layer)
    d = ImageDraw.Draw(img)
    # Satelity ako ANULUS. Jadro sa kreslí AŽ POTOM a je len zlatý kotúč — v tomto
    # cykle nesmie byť: `r - w/2` by mu pri w = 0 vyrezal atramentový disk presne
    # tam, kam patrí zlato, teda by jadro zmizlo.
    for node in geo["nodes"][1:]:
        disc(node.x, node.y, node.outer, mini.acc_dark)
        disc(node.x, node.y, node.r - node.w / 2, ink)
    core = geo["nodes"][0]
    disc(core.x, core.y, core.gold, mini.gold_dark)
    return img.resize((px, px), Image.LANCZOS)


def build_icos(mini: Mini, ink: str) -> None:
    frames = [raster(mini, ink, px) for px in ICO_SIZES]
    buf = io.BytesIO()
    # PIL skladá multi-size .ico z najväčšieho obrázka + zoznamu veľkostí;
    # append_images dodá presné rámce, aby sa menšie neškálovali z 256 px.
    frames[-1].save(buf, format="ICO", sizes=[(px, px) for px in ICO_SIZES],
                    append_images=frames[:-1])
    data = buf.getvalue()
    emit(ROOT / "public" / "favicon.ico", data)
    emit(ROOT / "electron" / "assets" / "hades.ico", data)

    apple = io.BytesIO()
    raster(mini, ink, APPLE_TOUCH_PX).save(apple, format="PNG", optimize=True)
    emit(BRAND / "apple-touch-icon.png", apple.getvalue())


# --------------------------------------------------------------------------- #
# 6. Electron chrome a offline stav
# --------------------------------------------------------------------------- #

def patch_between(path: Path, start: str, end: str, block: str) -> None:
    src = read(path)
    pat = re.compile(re.escape(start) + r".*?" + re.escape(end), re.S)
    if not pat.search(src):
        raise SystemExit(f"{path.name}: chýbajú markery {start} … {end}")
    body = block.replace("\n", newline_of(src))
    emit(path, pat.sub(lambda _: start + body + end, src, count=1))


def build_electron_html(mini: Mini) -> None:
    """Znak v Electron chrome (16 px) a v offline stave (84 px).

    DVA RÔZNE STUPNE REBRÍKA v jednom behu, a to je celý dôvod, prečo tu tá funkcia
    je namiesto jedného bloku:
      * topbar má `.sigil` 16 px  -> JEDEN UZOL (mini kánon, prstenec + zlatý stred),
      * offline stav má 84 px     -> SIEŤ Z PRSTENCOV (od 2. 9. 2026; predtým disky).

    Prečo offline prešiel z diskov na prstence: prah nesie najtenší prvok a ten sa
    prevzatím `SIGIL_NET` zmenil. Zmerané pri 84 px — obrys satelitu 4,20 px, hrana
    3,85 px, obe nad podlahou 1,5 px; so starou geometriou mal obrys 1,13 px, teda
    pod ňou, a disky boli správny ústupok. Ten ústupok tu už nemá čo obhájiť.

    ELECTRON DOKUMENTY NENAČÍTAVAJÚ `mind.css`, takže si nesú vlastnú kresbu aj
    vlastnú tichú verziu `prefers-reduced-motion`. Generátor vlastní GEOMETRIU
    a základnú kresbu (medzi markermi), dramaturgiu a tichú verziu vlastní dokument
    a stoja ZÁMERNE MIMO markerov — inak by ich prvý beh generátora zmazal. Kontrakt
    tried preto NEVYMÝŠĽAM: `.edge` / `.nodes` > `.node` / `.core` v tom dokumente
    už sú a visí na nich jeho pohyb. `.nodes` musí mať PRESNE tri deti: stupňovanie
    zrodu ide cez `:nth-child(2)` / `(3)`. Základný stav je tam dosadnutý znak
    (hrany dokreslené, uzly plné) a pohyb je zabalený do
    `@media (prefers-reduced-motion: no-preference)`, takže tichá verzia je
    zmysluplný okamžitý ekvivalent, nie zamrznutý polostav.

    `pathLength="100"` na každej hrane je povinné: hrany sú rôzne dlhé (6,10–8,13
    jednotky viewBoxu 24), takže jedna konštanta `stroke-dasharray: 100` bez
    normalizácie dokreslí jednu a ostatné zastaví v polovici.
    """
    c = num(mini.cx)
    topbar = (
        "\n"
        f'      <svg class="sigil" viewBox="0 0 {num(mini.box)} {num(mini.box)}" aria-hidden="true">\n'
        f'        <circle cx="{c}" cy="{c}" r="{num(mini.ring_r)}" fill="none" '
        f'stroke="var(--accent)" stroke-width="{num(mini.ring_w)}"></circle>\n'
        f'        <circle cx="{c}" cy="{c}" r="{num(mini.core_r)}" fill="var(--gold)"></circle>\n'
        "      </svg>\n      "
    )
    patch_between(ROOT / "electron" / "chrome" / "topbar.html",
                  "<!-- ZNAK: generuje", "<!-- /ZNAK -->",
                  " tools/brand/build-mark.py zo hades-sigil-mini.svg.\n"
                  "           Needituj ručne. JEDEN UZOL, nie sieť: `.sigil` je tu 16 px, teda hlboko pod\n"
                  f"           NET_MIN_PX ({NET_MIN_PX}) — z hrán by bolo vidno 2,6 px stubla. Znak tu nesie\n"
                  "           rolu „desktop okno\" (identita appky v ráme, ktorý nie je prehliadač), preto sa\n"
                  "           NEANIMUJE — pulz behu patrí #brand-core. -->"
                  + topbar)

    geo = net_geometry(mini)
    nodes = geo["nodes"]
    core = nodes[0]
    # Prstencový stupeň: konce hrán sú z `SIGIL_NET`, teda zo stredu jadra na
    # vonkajší okraj prstenca satelitu. Kresliť ich od stredu k stredu (ako to
    # robil diskový stupeň) by tu nechalo hranu prekročiť dieru satelitu a spoj
    # by vyzeral prepichnutý.
    edge_lines = []
    for e in geo["edges"]:
        cls = "edge edge--lat" if e["lat"] else "edge"
        edge_lines.append(
            f'            <path class="{cls}" pathLength="100" '
            f'd="M {num(e["x1"])} {num(e["y1"])} L {num(e["x2"])} {num(e["y2"])}"></path>')
    node_lines = [
        f'                <circle class="node" cx="{num(n.x)}" cy="{num(n.y)}" '
        f'r="{num(n.r)}" stroke-width="{num(n.w)}"></circle>'
        for n in nodes[1:]
    ]

    off = ROOT / "electron" / "states" / "offline.html"
    markup = "\n".join([
        "",
        f'        <svg class="sigil" viewBox="0 0 {num(mini.box)} {num(mini.box)}" aria-hidden="true">',
        *edge_lines,
        '            <g class="nodes">',
        *node_lines,
        "            </g>",
        f'            <circle class="core" cx="{num(core.x)}" cy="{num(core.y)}" '
        f'r="{num(core.gold)}"></circle>',
        "        </svg>",
        "        ",
    ])
    patch_between(off, "<!-- ZNAK: generuje", "<!-- /ZNAK -->",
                  " tools/brand/build-mark.py — needituj ručne.\n"
                  "             SIEŤ v PRSTENCOVOM stupni (`.sigil` je 84 px, prah siete je\n"
                  f"             {NET_MIN_PX} px). Súradnice sú kánon appky (`public/js/shared/sigil.js`,\n"
                  "             tabuľka SIGIL_NET) prepočítaný na tento box — nie ručná kresba.\n"
                  "             Hrany od jadra idú z jeho STREDU (skryté pod zlatým kotúčom) na okraj\n"
                  "             prstenca satelitu; štvrtá je chorda medzi dvoma satelitmi.\n"
                  "             `.nodes` musí obsahovať PRESNE tri uzly: zrod ide cez :nth-child(2)/(3). -->"
                  + markup)

    style = "\n".join([
        "",
        "        .sigil .edge { fill: none; stroke: var(--accent); "
        f"stroke-width: {num(geo['edge_w'])}; stroke-linecap: round; opacity: .8; }}",
        "        .sigil .edge--lat { opacity: .5; }",
        "        .sigil .node { fill: none; stroke: var(--accent); }",
        f"        .sigil .core {{ fill: var(--gold); transform-origin: {num(mini.cx)}px {num(mini.cy)}px; }}",
        "        ",
    ])
    patch_between(off, "/* ZNAK-STYLE: generuje", "/* /ZNAK-STYLE */",
                  " tools/brand/build-mark.py z public/js/shared/sigil.js.\n"
                  "           Needituj ručne — pri najbližšom behu generátora sa zmena stratí.\n"
                  "           Dôvod, prečo je geometria aj tu: tento dokument sa zobrazuje, KEĎ SERVER\n"
                  "           NEBEŽÍ, takže nemôže načítať mind.css ani nič z public/. Z toho istého\n"
                  "           dôvodu si nesie aj vlastnú tichú verziu prefers-reduced-motion — je nižšie,\n"
                  "           mimo týchto markerov, a je to dosadnutý znak, nie „vypnuté\".\n"
                  "           ZNAK JE SIEŤ (1. 9. 2026): prstenec (`.ring`) je retirovaný — v sieti nie je\n"
                  "           zavretá krivka, ktorú by pomenoval. Uzly sú tu PRSTENCE (od 2. 9. 2026, keď\n"
                  "           kánon prevzal geometriu appky): obrys satelitu má pri 84 px\n"
                  f"           {min(n.w for n in nodes[1:]) * 0.84:.2f} px a hrana {geo['edge_w'] * 0.84:.2f} px, "
                  f"teda nad podlahou {num(RING_LW_FLOOR_PX)} px.\n"
                  "           Šírku obrysu nesie MARKUP (`stroke-width` na uzle), nie toto pravidlo:\n"
                  "           je to geometria, a tá patrí do jedného zdroja. JADRO je len zlatý kotúč —\n"
                  "           amethystový prstenec okolo neho je retirovaný. */"
                  + style)


# --------------------------------------------------------------------------- #
# 7. odvodené čísla pre súbory, ktoré generátor nevlastní
# --------------------------------------------------------------------------- #

def derived(mini: Mini) -> dict[str, object]:
    """Mini kánon prepočítaný na viewBox appky (24) — stupeň redukcie `'core'`.

    Čo tu do 2. 9. 2026 bolo a ODIŠLO, pretože to prestalo mať čitateľa:
      * `dasharray` (obvod prstenca 2π × 8,64 = 54,29) — `mind.css` dnes používa
        `stroke-dasharray: 100`, čo NIE JE obvod ničoho, ale `pathLength="100"`
        na hranách. Obvod prstenca už žiadne pravidlo nekreslí.
      * tri čísla `.load-mark` (box 26 / `border` 2 / jadro 8) — `.load-mark`
        prestal byť CSS `border` a je to inline `<svg>` v boxe 32 px, ktoré kreslí
        `sigilNetMarkup()`. Odvodzovať `border` pre pravidlo, ktoré ho nemá, by
        znamenalo vydávať čísla do prázdna a tváriť sa, že ich niekto číta.
    Vydávať mŕtve čísla je horšie než ich nevydávať: čitateľ podľa nich niečo
    „opraví" a rozbije funkčný súbor.
    """
    scale = BLADE_VIEWBOX / mini.box
    return {
        "blade_ring_r": mini.ring_r * scale,
        "blade_stroke": mini.ring_w * scale,
        "blade_core_r": mini.core_r * scale,
    }


def blade_inline_svg(mini: Mini, d: dict[str, object]) -> str:
    """Stupeň `'core'` tak, ako ho vydáva appka — kontrola, nie druhý výkres.

    Toto je presne to, čo vráti `sigilNetMarkup(cls, {step:'core'})` v
    `public/js/shared/sigil.js`, poskladané z mini pomerov. Nikto to nemá odtiaľto
    prepisovať do Blade: statický markup si appka nesie sama a generátor ju
    negeneruje. Blok existuje, aby sa dalo OKOM porovnať, či sa stupeň redukcie
    nerozišiel — čo `assert_mini_matches_app()` overuje aj číselne.

    Triedy sú appkine (`bc-nodes` > `bc-node`, `bc-core`), nie `bc-ring`: tá
    v repe už neexistuje a niesol ju posledný mŕtvy nosič v `console/render.js`.
    Kánon akcentu: prstenec je AMETHYST (interaktívny nosič), jadro ZLATÉ (značka).
    """
    c = num(BLADE_VIEWBOX / 2)
    return (
        f'<svg viewBox="0 0 {BLADE_VIEWBOX} {BLADE_VIEWBOX}" aria-hidden="true">\n'
        '    <g class="bc-nodes">\n'
        f'        <circle class="bc-node" cx="{c}" cy="{c}" r="{num(d["blade_ring_r"])}" '
        f'fill="none" stroke="var(--accent)" stroke-width="{num(d["blade_stroke"])}"/>\n'
        "    </g>\n"
        f'    <circle class="bc-core" cx="{c}" cy="{c}" r="{num(d["blade_core_r"])}" '
        f'fill="var(--brand-gold)"/>\n'
        "</svg>"
    )


def build_derived_md(mini: Mini, ink: str, uri: str, d: dict[str, object]) -> None:
    net = net_canon()
    md = f"""<!-- GENEROVANÉ tools/brand/build-mark.py — needituj ručne. -->
# Odvodené hodnoty znaku

Tento súbor je výstup `tools/brand/build-mark.py`. Nesie čísla pre miesta, ktoré
generátor **nevlastní** (CSS a Blade markup), aby ich nikto nepočítal rukou. Keď sa
zmení `hades-sigil-mini.svg`, spusti generátor a prepíš podľa tejto tabuľky.

Regenerácia:

```
python tools/brand/build-mark.py
```

## Kánon mini (zo zdroja)

| Vec | Hodnota |
|---|---|
| viewBox | {num(mini.box)} × {num(mini.box)} |
| prstenec | r {num(mini.ring_r)} · hrúbka {num(mini.ring_w)} · pomer {mini.ring_ratio:.4f} boxu |
| jadro | r {num(mini.core_r)} · pomer priemeru {mini.core_diameter_ratio:.4f} boxu |
| akcent (tmavá / svetlá) | `{mini.acc_dark}` / `{mini.acc_light}` |
| zlatá (tmavá / svetlá) | `{mini.gold_dark}` / `{mini.gold_light}` |
| atramentový disk | r {num(mini.disk_r)} · `{ink}` (z `--bg-rgb` tmavej témy v mind.css) |

## Pre `public/css/mind.css` a Blade — stupeň `'core'` vo viewBoxe {BLADE_VIEWBOX}

Mini kánon prepočítaný na mriežku appky. Sú to **živé** čísla: `sigilNetMarkup(cls,
{{step: 'core'}})` v `public/js/shared/sigil.js` kreslí presne tento tvar a nesú ho
24 px hlavičkové nosiče (`#brand-core`, `#back-to-graph`, `#chat-home`).

| Vec | viewBox {BLADE_VIEWBOX} | pomer boxu |
|---|---|---|
| prstenec | r {num(d["blade_ring_r"])} · obrys {num(d["blade_stroke"])} | {mini.ring_ratio:.4f} / {mini.stroke_ratio:.4f} |
| zlaté jadro | r {num(d["blade_core_r"])} | {mini.core_diameter_ratio / 2:.4f} |

`SIGIL_NET.mini` v appke nesie `r {num(net.mini_r)} / sw {num(net.mini_sw)} /
gold {num(net.mini_gold)}` — tie isté tri čísla, a generátor to **vynucuje**
(`assert_mini_matches_app()`). Keď niekto prekreslí `hades-sigil-mini.svg` a zabudne
na appku, generátor padne namiesto toho, aby vydal favicon s iným redukovaným znakom,
než aký nesie rail.

```html
{blade_inline_svg(mini, d)}
```

Blok je **kontrola, nie zadanie**: statický markup si appka nesie sama (v Blade musí
SVG stáť priamo, inak stránka najprv ukáže prázdno) a generátor ho neprepisuje.

**Čo z tejto sekcie ODIŠLO 2. 9. 2026 a prečo:** `stroke-dasharray` odvodený z obvodu
prstenca (2π × {num(d["blade_ring_r"])}) a tri čísla `.load-mark` (box 26, `border`,
jadro). Ani jedno už nemá čitateľa — `mind.css` používa `stroke-dasharray: 100`, čo je
`pathLength="100"` na hranách a nie obvod ničoho, a `.load-mark` prestal byť CSS
`border`: je to inline `<svg>` v boxe {LOAD_MARK_BOX_PX} px. Vydávať odvodené číslo
do prázdna je horšie než ho nevydať, pretože podľa neho niekto „opraví" funkčný súbor.

## data-URI faviconu (`resources/views/partials/brand-icons.blade.php`, spravuje generátor)

Jeden cieľ, nie tri: page blade si partial `@include`ujú a generátor si overuje,
že žiadna z nich nemá vlastný `<link rel="icon">`.

```
{uri}
```

## Lockupy a rastrové derivát y — DVA generátory, jeden kánon

Lockupy (`hades-lockup-h.svg`, `hades-lockup-v.svg`) vydáva tento generátor: vymení
v nich **skupinu `.sig`** za aktuálny master a wordmark nechá presne tam, kde je.
Umiestnenie wordmarku (výška znaku : výška verzálky = 1,55 : 1, medzera 0,34 ×
výška znaku) vypočítal retirovaný `docs/build-brand.py` z metrík fontu Cinzel,
ktorý v tejto vetve nie je — preto sa neprepočítava, len zachováva.

Do 28. 8. 2026 lockupy generátor **nevlastnil nikto** a nesli geometriu starého
mastera (prstenec r 34, jadro r 8,5) dlho po tom, ako sa master zmenil. Assety bez
generátora zastarajú a nikto si to nevšimne.

PNG derivát y (`hades-lockup-300/600/1200.png`, `hades-sigil-128/256/512.png`,
`hades-og.png`) vydáva **`tools/brand/build-raster.js`** (node + headless Chrome).
Je to druhý skript, a to zámerne: PIL v tomto generátore vie kresliť kruhy, takže
zvládne favicon aj `.ico`, ale **wordmark je písmo v krivkách a ten nenakreslí**.
V prostredí nie je žiadny SVG rasterizér (`cairosvg` chýba, `convert` je Windowsov
konvertor diskov, nie ImageMagick), takže rasterizuje Chrome — cesta, ktorú si
projekt zapísal ako funkčnú v CLAUDE.md.

**Poradie je povinné**, PNG sa fotia z hotových SVG:

```
python tools/brand/build-mark.py     # SVG kánon
node   tools/brand/build-raster.js   # PNG z neho
```
"""
    geo = net_geometry(mini)
    rows = ladder(mini, geo)
    core = geo["nodes"][0]
    sats = geo["nodes"][1:]
    angs = [math.degrees(math.atan2(n.y - core.y, n.x - core.x)) % 360 for n in sats]
    srt = sorted(angs)
    gaps = [(srt[(i + 1) % 3] - srt[i]) % 360 for i in range(3)]
    area = abs((sats[1].x - sats[0].x) * (sats[2].y - sats[0].y)
               - (sats[2].x - sats[0].x) * (sats[1].y - sats[0].y)) / 2
    # Odstup chordy od jadra — TÁ ISTÁ matematika, akú kontroluje `assert_optical()`.
    # Neopisujem číslo, vyrátam ho, aby sa dokument nemohol rozísť so strážou.
    lat = next(e for e in geo["edges"] if e["lat"])
    dx, dy = lat["x2"] - lat["x1"], lat["y2"] - lat["y1"]
    seg = math.hypot(dx, dy)
    ux, uy = dx / seg, dy / seg
    t = max(0.0, min(seg, (core.x - lat["x1"]) * ux + (core.y - lat["y1"]) * uy))
    chord_d = math.hypot(core.x - (lat["x1"] + ux * t), core.y - (lat["y1"] + uy * t))
    cutout = assert_same_cutout(geo, net)

    lad = "\n".join(
        f'| {r["px"]} px | {r["stage"]} | {r["thinnest"]:.2f} px | '
        f'{r["ring_thinnest"]:.2f} px | {r["stub_thinnest"]:.2f} px | {r["shapes"]} | '
        f'{"drží" if r["ok"] else "PADÁ"} |'
        for r in rows)

    md += f"""
## Znak je SIEŤ a jej geometriu vlastní APPKA (rozhodnuté 2. 9. 2026)

Znak je **výsek siete**: jadro a tri satelity, viazané štyrmi hranami (tri z jadra
+ jedna chorda medzi satelitmi). Prstencový znak „Jedno oko" je retirovaný a jeho
slovník sa neprekladá — v sieti nemá čo pomenovať.

**Tabuľka geometrie žije v `public/js/shared/sigil.js` (`SIGIL_NET`, viewBox
{num(Net.BOX)}) a tento generátor ju PARSUJE.** Do 2. 9. 2026 tu boli vlastné polárne
`NET_SATS` a bol to druhý výkres tej istej siete: kánon mal satelity v troch rôznych
veľkostiach na 195° / 58° / -68° vo vzdialenostiach 36 / 39,5 / 41 boxu 100, appka
vlastné karteziánske súradnice v boxe 24 — a jadro mali RÔZNE (appka plný zlatý kotúč,
kánon amethystový prstenec so zlatým stredom). Rozhodnutie: **vyhráva appka**, pretože
prstenec okolo jadra by z jadra urobil štvrtý prstencový uzol a „jadro = jediný sýty
plný prvok" by prestalo platiť.

| Prvok | stred (box {num(mini.box)}) | polomer | obrys | pomer stredu k boxu |
|---|---|---|---|---|
| jadro (plné, zlaté) | {num(core.x)}, {num(core.y)} | r {num(core.gold)} | — | {core.x / mini.box:.6f}, {core.y / mini.box:.6f} |
""" + "".join(
        f"| satelit {i} (prstenec) | {num(n.x)}, {num(n.y)} | r {num(n.r)} | "
        f"{num(n.w)} | {n.x / mini.box:.6f}, {n.y / mini.box:.6f} |\n"
        for i, n in enumerate(sats, 1)) + f"""
Hrany (šírka {num(geo["edge_w"])}, bočná na 50 % krytia proti 80 % u hrán od jadra).
„Vidno" je dĺžka MIMO zlatého kotúča jadra — prvých {num(core.gold)} jednotiek každej
hrany od jadra je pod ním skrytých:

| hrana | dĺžka cesty | vidno | rola |
|---|---|---|---|
""" + "".join(
        "| {} | {:.2f} | {:.2f} | {} |\n".format(
            i, e["len"], e["vis"],
            "chorda satelit-satelit" if e["lat"] else "jadro -> satelit")
        for i, e in enumerate(geo["edges"], 1)) + f"""
### DÔKAZ: kánon a appka kreslia ten istý výsek

`assert_same_cutout()` porovnáva **normalizované pomery** — každú vydanú súradnicu
delenú boxom mastera ({num(mini.box)}) proti tej istej súradnici delenej boxom appky
({num(Net.BOX)}). Zmerané pri tomto behu: **{cutout} pomerov, všetky do 1e-9**, teda
identické. A to isté meranie na **vydanom** `hades-sigil.svg`, nie na modeli v pamäti:
{d["emitted_n"]} pomerov, najhorší rozdiel **{d["emitted_worst"]:.6f} boxu** proti stropu
zaokrúhlenia 0,000050 (`num()` reže na dve desatiny, takže 6,27/24 = 0,261250 je v súbore
zapísané ako 26,12/100 = 0,261200). Bez tej druhej polovice by sa dalo tvrdiť „pomery
sedia" o čísle, ktoré v súbore nie je.

Nie je to tautológia z toho, že generátor tabuľku appky číta: keby prepočet
niesol offset, iný stred alebo zaokrúhlenie, stráž padne. Absolútne hodnoty sa
NEZHODUJÚ a zhodovať sa nemajú (jadro r {num(core.gold)} v boxe {num(mini.box)} proti
r {num(net.core[2])} v boxe {num(Net.BOX)}) — **identita je v pomeroch**.

**Kompozícia je optická, nie mriežková, a generátor si to VYNUCUJE**
(`assert_optical()`): rozstupy uhlov satelitov vyšli
{gaps[0]:.0f}° / {gaps[1]:.0f}° / {gaps[2]:.0f}° — teda ani rovnostranný trojuholník
(3 × 120°), ani úsečka (plocha trojuholníka {area:.0f} = {area / mini.box ** 2:.3f}
boxu², prah 0,12 boxu²). Chorda jadro obchádza s odstupom {chord_d:.2f} proti jeho
okraju {num(core.gold)}. Keby niekto v `sigil.js` zmenil jedno číslo tak, že
kompozícia sadne do mriežky alebo že chorda prejde cez jadro, **generátor padne**
namiesto toho, aby vydal iný znak.

## Stupne redukcie — namerané, nie odhadnuté

Podlaha kontrastu obrysu je **{RING_LW_FLOOR_PX} px** (CLAUDE.md, „Vizuálna sémantika").
Prah siete je **{NET_MIN_PX} px** a je **STUBLOVÝ, nie obrysový**: rozhoduje, či
z hrany vidno dosť na to, aby znak hovoril „sieť". Pri {NET_MIN_PX} px vidno
{rows[2]["stub_thinnest"]:.2f} px z najkratšej hrany, pri 24 px už len
{rows[1]["stub_thinnest"]:.2f} px — a to je stubla, nie spojenie. Prah nesie appka
(`shared/sigil.js`) a kánon ho prevzal, pretože je to ten istý znak.

Rebrík mal do 2. 9. 2026 **tri** stupne a stredný (sieť z plných diskov) je
retirovaný. Nebol to zbytočný stupeň, ale dôsledok STAREJ geometrie: hrana široká
1,8 v boxe 100 je 0,018 boxu, `SIGIL_NET` má {num(net.edge_sw)} v boxe {num(Net.BOX)},
teda {net.edge_sw / Net.BOX:.3f} boxu — **{(net.edge_sw / Net.BOX) / 0.018:.1f}x
hrubšie**. Rovnaká podlaha 1,5 px preto padne o dva a pol stupňa nižšie a ústupok
„zahoď obrys, kresli disky" stratil dôvod.

Stĺpec „prstence by mali" je kalibrácia opačným smerom: koľko by meral najtenší prvok
siete, keby sa kreslila aj na tejto veľkosti.

| px | čo sa kreslí | najtenší prvok | prstence by mali | najkratšia stubla | tvarov | podlaha |
|---|---|---|---|---|---|---|
{lad}

Čo presne na ktorom stupni **zmizne**:

* **16 px, 24 px** — jeden uzol: amethystový prstenec, zlatý stred. Hrany aj satelity
  sú zatvorené. Toto je stupeň faviconu (`hades-favicon.svg`, data-URI, rámce `.ico`
  16–24), Electron topbaru (`.sigil` 16 px) a 24 px hlavičkových nosičov appky
  (`#brand-core`, `#back-to-graph`, `#chat-home`). Zmizne presne to, čo hovorí
  `shared/sigil.js`: tri satelity a všetky štyri hrany. Amethyst prežije — zlatý kotúč
  sám by značka nebol.
* **{NET_MIN_PX} px a viac** — **plná sieť z prstencov**, kánon bez ústupkov: štyri
  hrany, tri prstencové satelity, plné zlaté jadro. Nezmizne nič.

**Riadok 16 px hlási PADÁ a je to priznanie, nie chyba tabuľky.** Obrys jedného uzla
má pri 16 px {mini.ring_w * 0.16:.2f} px, teda pod podlahou {RING_LW_FLOOR_PX} px.
Vykreslený rámec je čitateľný (`.ico` sa rastruje {SUPERSAMPLE}x nadvzorkovane
a LANCZOSom), takže to nie je porucha, ktorú by bolo vidieť — ale číslo je pod
podlahou a zamlčať sa nemá.

**A riadok {NET_MIN_PX} px hlási PADÁ rovnako priznane.** Hrana má pri {NET_MIN_PX} px
{rows[2]["ring_thinnest"]:.2f} px, teda **{RING_LW_FLOOR_PX - rows[2]["ring_thinnest"]:.2f} px
pod podlahou** — pri obryse satelitu {min(n.w for n in sats) * 32 / mini.box:.2f} px, ktorý
drží. Nie je to omyl v prahu: prah je stublový a appka na tomto nosiči plnú sieť
NAOZAJ kreslí (`.load-mark`, `.charon-sigil`, oba {LOAD_MARK_BOX_PX} px). Je to ten
istý argument, aký si projekt zapísal o hranách plátna: jedna vláska prah nespĺňa,
informáciu nesie hustota — a tu ju nesie stubla, ktorá má {rows[2]["stub_thinnest"]:.2f} px,
teda {rows[2]["stub_thinnest"] / rows[2]["ring_thinnest"]:.1f}x viac než svoju šírku.
Zdvihnúť hranu na 1,5 px by znamenalo prekresliť `SIGIL_NET`, teda znak na všetkých
troch plochách appky — to nie je oprava tabuľky, ale zmena znaku.

Dôsledok pre `.ico`: multi-size ikona nesie **dva rôzne výkresy** (16–24 jeden uzol,
{NET_MIN_PX}–256 plná sieť). Presne na to multi-size `.ico` je; jeden škálovaný výkres
by buď na 16 px zamrzol do kaše, alebo na 256 px stratil sieť.

## Nosiče znaku — čo kam patrí

| nosič | veľkosť | stupeň | poznámka |
|---|---|---|---|
| `<link rel="icon">` data-URI | 16–24 px | jeden uzol | `hades-favicon.svg`, spravuje generátor |
| Electron topbar `.sigil` | 16 px | jeden uzol | generátor, medzi ZNAK markermi |
| `#brand-core`, `#back-to-graph`, `#chat-home` | 24 px | jeden uzol | appka, stupeň `'core'` |
| `.load-mark`, `.charon-sigil` | {LOAD_MARK_BOX_PX} px | plná sieť | appka; `.load-mark` už nie je CSS `border` |
| `.empty-sigil`, `.ce-mark` | 44 px | plná sieť | appka |
| Electron offline `.sigil` | 84 px | plná sieť | generátor; do 2. 9. 2026 disky |
| `apple-touch-icon.png` | 180 px | plná sieť | generátor |
| PNG znaku 128/256/512, OG, lockupy | ≥ 128 px | plná sieť | generátor |

`errors/401.blade.php` je zámerne mimo tejto tabuľky aj mimo generátora: nesie tú istú
geometriu vlastnými lokálnymi triedami, pretože `mind.css` sa tam nenačítava a appka
ten dokument nevydáva cez router.

## Electron: dva dokumenty, ktoré si nesú znak SAMY

`electron/chrome/topbar.html` a `electron/states/offline.html` **nenačítavajú
`mind.css`** — offline stav sa zobrazuje práve vtedy, keď server nebeží. Preto majú
vlastnú kresbu (generátor, medzi markermi `ZNAK` a `ZNAK-STYLE`) **aj vlastnú tichú
verziu `prefers-reduced-motion`** (dokument, zámerne MIMO markerov, inak by ju prvý
beh generátora zmazal).

Tichá verzia je tam postavená správne a treba to tak nechať: základný stav je
**dosadnutý znak** (hrany `stroke-dashoffset: 0`, uzly `scale(1)`, plná farba)
a pohyb je zabalený v `@media (prefers-reduced-motion: no-preference)`. Nie
`animation: none` nad rozbehnutým stavom — to by hranu nechalo s `dashoffset` = dĺžka,
teda NEVIDITEĽNÚ, a znak by sa rozpadol na tri uzly bez spojení.

`.core` má `transform-origin` v ZNAK-STYLE (view-box súradnice, stred boxu), uzly
`transform-box: fill-box` + `center` v dokumente — uzly majú tri rôzne stredy, takže
konštanta by musela byť v CSS trikrát.

## Kde geometria siete NIE JE, hoci by tam patrila

Kánon dnes vydáva jednu geometriu z jedného zdroja, ale **kontrakt tried `.bc-mark`
v `mind.css` je stále vlastný zápis** — spína zrod, nekreslí tvar, a nič v kóde
nevynucuje, že jeho `pathLength`/dash matematika sedí s výkresom. Zmena geometrie sa
preto musí overiť **meraním na bežiacej appke**, nie čítaním jedného zdroja. Toto je
posledné miesto, kde môže znak driftnúť tichom.
"""
    emit(TOOLS / "DERIVED.md", md)


# --------------------------------------------------------------------------- #

# --------------------------------------------------------------------------- #
# 6b. MASTER — SIEŤ (nový znak, 1. 9. 2026)
# --------------------------------------------------------------------------- #
#
# Znak je VÝSEK SIETE: jadrový uzol a tri vedľajšie uzly, viazané hranami.
# Prstencový znak („Jedno oko": nosný prstenec + prerušenie + satelit + obežnica)
# je retirovaný — jeho slovník (prerušenie, delenia po 30°, hranica vedomia)
# sa NEPREKLÁDA, pretože v sieti nemá čo pomenovať.
#
# GEOMETRIU TU UŽ NEDRŽÍM. Do 2. 9. 2026 tu stáli polárne `NET_SATS`
# (-68° / 195° / 58°, vzdialenosti 36 / 39,5 / 41, tri rôzne veľkosti uzlov) a bol
# to DRUHÝ výkres tej istej siete — appka mala vlastný v `SIGIL_NET`. Rozišli sa
# presne tak, ako sa predtým rozišli master a mini: obe ruky mali „pravdu", ktorú
# nikto nemeral proti druhej. Rozhodnutie používateľa: vyhráva APPKA. Tabuľka sa
# preto PARSUJE zo `public/js/shared/sigil.js` a v tomto súbore nie je ani jedno
# číslo geometrie siete.
#
# Čo z mini kánonu zostáva a čo sa zmenilo:
#   * ZOSTÁVA vizuálna sémantika plátna: satelit je PRSTENEC (priehľadnosť nesie
#     diera, nie nízka alfa), jadro je jediný sýty PLNÝ prvok a je zlaté;
#     hrany a nesýte uzly sú amethyst (BRAND-HADES §6).
#   * JADRO NEMÁ AMETHYSTOVÝ PRSTENEC. Do 2. 9. 2026 ho kánon kreslil (mini pomery
#     0,36 / 0,09 na vlastnom boxe 38) a appka nie. Prstenec okolo jadra by z jadra
#     urobil ŠTVRTÝ prstencový uzol a „jediný sýty plný prvok" by prestalo byť
#     jediné — preto zmizol z kánonu, nie z appky.
#   * IDENTITA MINI <-> MASTER je v POMERE, nie v absolútnych hodnotách, a je to
#     TEN ISTÝ pomer ako v appke: `SIGIL_NET.mini` (r 8,64 / obrys 2,16 / zlato 3,6
#     vo viewBoxe 24) je mini kánon (0,36 / 0,09 / 0,15 boxu) prepočítaný na 24.
#     `assert_mini_matches_app()` to vynucuje — keď niekto prekreslí mini SVG bez
#     appky, generátor padne namiesto toho, aby vydal dva rôzne redukované znaky.
#
# Kompozícia je OPTICKÁ, nie mriežková, a je to overiteľná podmienka:
# `assert_optical()` nižšie odmietne rovnostranný trojuholník aj úsečku a odmietne
# bočnú hranu, ktorá by prešla cez jadro. Stráže zostávajú, aj keď sa tabuľka
# presunula do appky — príde ju zmeniť ten, kto edituje `sigil.js`, a padnúť to má
# tu, pri vydávaní assetov.

# Prah redukcie. 32 px, a je to prah, ktorý si nameral NOSIČ APPKY, nie tento
# generátor: pod ním sa hrany scvrknú na 3,5 px stuble a znak prestane hovoriť
# „sieť" (dôvod je rozpísaný v `shared/sigil.js`). Predtým tu stálo 128 s troma
# stupňami rebríka a bolo to dôsledok STAREJ geometrie: hrana široká 1,8 v boxe
# 100 je 0,018 boxu, kdežto `SIGIL_NET` má 1,1 v boxe 24, teda 0,046 boxu — 2,5×
# hrubšie. Rovnaká podlaha 1,5 px preto padne o dva a pol stupňa nižšie a diskový
# stupeň (uzly plné, obrys zahodený) stratil dôvod existovať. Retiroval som ho:
# bol to ústupok geometrii, ktorá už nie je v repe.
NET_MIN_PX = 32
RING_LW_FLOOR_PX = 1.5

# Stubla hrany musí byť násobkom jej vlastnej šírky, nie absolútne číslo: rozhoduje,
# či hrana vyzerá ako SPOJENIE, alebo ako čiarka pri uzle. 2,5× je kalibrované
# z oboch strán — dnešná najkratšia stubla (3,50 jednotky proti obrysu 1,10) prejde
# s rezervou 0,75, a stará geometria, ktorá dávala 1,24 jednotky pri obryse 1,8,
# by neprešla ani zdaleka. Prah v jednotkách viewBoxu appky, aby sa nemusel
# prepočítavať pri každom nosiči.
NET_STUB_FLOOR_RATIO = 2.5


class Node:
    """Uzol siete v jednotkách boxu mastera.

    `outer` je vonkajší okraj kresby (polomer + polovica obrysu) — hrany `SIGIL_NET`
    končia presne na ňom (zmerané: 2,500 pri r 1,9 + obryse 1,2 vo viewBoxe 24),
    takže sa obrys uzla a hrana dotýkajú bez pahýľa aj bez presahu.

    Jadro je PLNÝ kotúč: `r == gold` a `w == 0`, takže mu `outer` vyjde na okraj
    zlata. Nie je to trik — je to presne to, čo o jadre hovorí kánon, a stráž
    `assert_optical()` vďaka tomu meria odstup bočnej hrany od SKUTOČNE nakresleného
    okraja jadra, nie od neexistujúceho prstenca.
    """

    def __init__(self, x: float, y: float, r: float, w: float, gold: float = 0.0):
        self.x, self.y, self.r, self.w, self.gold = x, y, r, w, gold

    @property
    def outer(self) -> float:
        return self.r + self.w / 2

    @property
    def is_core(self) -> bool:
        return self.gold > 0.0


class Net:
    """Kánon siete, vyparsovaný z `public/js/shared/sigil.js`.

    Parsujeme, nie kopírujeme — ten istý dôvod ako u `Mini`: keby sa v appke zmenila
    súradnica, všetky výstupy sa zmenia jedným behom generátora. A keď zdroj nesedí
    s očakávaným tvarom (jedno jadro, tri satelity, štyri hrany), padáme nahlas:
    tichý fallback by vydal iný znak než ten, ktorý appka kreslí.

    Regex, nie JS engine: `SIGIL_NET` je tabuľka čísel a literál sa nemení. Keby ho
    niekto prepísal na výpočet, parser padne — a to je správna reakcia, pretože potom
    by tu bola potrebná druhá implementácia toho výpočtu.
    """

    BOX = 24.0          # viewBox `SIGIL_NET`; identita sa počíta pomerom k nemu

    def __init__(self, js: str) -> None:
        m = re.search(r"const SIGIL_NET = \{(.*?)\n\};", js, re.S)
        if not m:
            raise SystemExit(f"{SIGIL_JS.name}: nenašiel som tabuľku SIGIL_NET")
        src = m.group(1)

        def nums(chunk: str) -> list[float]:
            return [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", chunk)]

        core = re.search(r"core:\s*\{([^}]*)\}", src)
        if not core:
            raise SystemExit(f"{SIGIL_JS.name}: SIGIL_NET nemá `core`")
        cx, cy, cr = nums(core.group(1))
        self.core = (cx, cy, cr)

        nodes = re.search(r"nodes:\s*\[(.*?)\]", src, re.S)
        if not nodes:
            raise SystemExit(f"{SIGIL_JS.name}: SIGIL_NET nemá `nodes`")
        self.nodes = [tuple(nums(c)) for c in re.findall(r"\{([^}]*)\}", nodes.group(1))]
        if len(self.nodes) != 3 or any(len(n) != 4 for n in self.nodes):
            raise SystemExit(
                f"{SIGIL_JS.name}: očakávam 3 satelity po 4 čísla (x, y, r, sw), "
                f"našiel {[len(n) for n in self.nodes]}")

        edges = re.search(r"edges:\s*\[(.*?)\n {4}\]", src, re.S)
        if not edges:
            raise SystemExit(f"{SIGIL_JS.name}: SIGIL_NET nemá `edges`")
        self.edges = [tuple(nums(c)) for c in re.findall(r"\[([^\]]*)\]", edges.group(1))]
        if len(self.edges) != 4 or any(len(e) != 4 for e in self.edges):
            raise SystemExit(
                f"{SIGIL_JS.name}: očakávam 4 hrany po 4 čísla (x1, y1, x2, y2), "
                f"našiel {[len(e) for e in self.edges]}")

        sw = re.search(r"edgeSw:\s*(-?\d+(?:\.\d+)?)", src)
        if not sw:
            raise SystemExit(f"{SIGIL_JS.name}: SIGIL_NET nemá `edgeSw`")
        self.edge_sw = float(sw.group(1))

        m2 = re.search(r"mini:\s*\{([^}]*)\}", src)
        if not m2:
            raise SystemExit(f"{SIGIL_JS.name}: SIGIL_NET nemá `mini` (stupeň redukcie)")
        self.mini_r, self.mini_sw, self.mini_gold = nums(m2.group(1))

    @property
    def lat_index(self) -> int:
        """Index bočnej hrany: tá jediná, ktorá nezačína v strede jadra.

        Odvodené z tabuľky, nie zapísané druhýkrát. `SIGIL_NET` nemá príznak `lat`
        a nemá ho mať — plocha appky ho nepotrebuje (kreslí všetky hrany rovnako),
        kánon áno (bočná hrana je slabšia, aby hierarchia „všetko sa viaže na jadro"
        zostala čitateľná).
        """
        cx, cy, _ = self.core
        for i, e in enumerate(self.edges):
            if abs(e[0] - cx) > 1e-9 or abs(e[1] - cy) > 1e-9:
                return i
        raise SystemExit(
            f"{SIGIL_JS.name}: každá hrana začína v jadre — to je hviezda, nie sieť")


_NET: Net | None = None


def net_canon() -> Net:
    """Kánon siete, načítaný raz za beh.

    Lenivý prístup, nie parameter naprieč šiestimi funkciami: `raster()` volá
    `build_icos()`, ten `main()`, a pretláčanie tabuľky cez celý ten stĺpec by
    z podpisov urobilo šum. Súbor sa počas behu nemení, takže je to čítanie
    jedného zdroja, nie skrytý stav.
    """
    global _NET
    if _NET is None:
        _NET = Net(read(SIGIL_JS))
    return _NET


def net_geometry(mini: Mini) -> dict[str, object]:
    """JEDEN zdroj geometrie siete pre SVG, PIL raster aj DERIVED.md.

    Prepočet `SIGIL_NET` (viewBox 24) na box mastera (100). Súradnice sa NEDOPOČÍTAVAJÚ
    z uhlov a vzdialenosti — v tabuľke appky sú hotové, aj so zárezom: hrany od jadra
    idú z jeho STREDU (tam sú skryté pod plným kotúčom) na vonkajší okraj prstenca
    satelitu, bočná hrana z okraja na okraj. Prepočítať to znovu by bola tá istá
    kresba po druhé, teda tá istá pasca.
    """
    net = net_canon()
    k = mini.box / Net.BOX
    cx, cy, cr = net.core
    core = Node(cx * k, cy * k, cr * k, 0.0, gold=cr * k)
    nodes = [core]
    for x, y, r, sw in net.nodes:
        nodes.append(Node(x * k, y * k, r * k, sw * k))

    lat = net.lat_index
    edges = []
    for i, (x1, y1, x2, y2) in enumerate(net.edges):
        length = math.hypot(x2 - x1, y2 - y1) * k
        edges.append({
            "x1": x1 * k, "y1": y1 * k, "x2": x2 * k, "y2": y2 * k,
            "lat": i == lat, "len": length,
            # VIDITEĽNÁ dĺžka: hrana od jadra vedie z jeho stredu, takže prvých
            # `gold` jednotiek je pod zlatým kotúčom. Nemeriam to odčítaním „ak je
            # od jadra", ale skutočným rezom úsečky o kruh jadra — bočná hrana tak
            # dostane 0 sama, bez výnimky v kóde.
            "vis": length - _core_overlap(core, x1 * k, y1 * k, x2 * k, y2 * k),
        })
    return {"nodes": nodes, "edges": edges, "box": mini.box,
            "edge_w": net.edge_sw * k, "k": k}


def _core_overlap(core: Node, x1: float, y1: float, x2: float, y2: float) -> float:
    """Dĺžka úseku úsečky, ktorý leží vnútri zlatého kotúča jadra."""
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy)
    ux, uy = dx / length, dy / length
    fx, fy = x1 - core.x, y1 - core.y
    b = fx * ux + fy * uy
    c = fx * fx + fy * fy - core.outer ** 2
    disc = b * b - c
    if disc <= 0:
        return 0.0
    root = math.sqrt(disc)
    t0, t1 = max(0.0, -b - root), min(length, -b + root)
    return max(0.0, t1 - t0)


def assert_optical(geo: dict[str, object]) -> None:
    """Kompozícia musí byť optická, nie mriežková — a musí sa dať zmerať.

    Tri podmienky, každá porušiteľná jedným číslom v `SIGIL_NET`:
      1. rozstupy uhlov sa nesmú rovnať (rovnostranný trojuholník),
      2. tri vedľajšie uzly nesmú ležať takmer na priamke (úsečka),
      3. bočná hrana nesmie prejsť cez jadro.

    Prahy sú v POMERE k boxu, nie absolútne: stráž musí platiť rovnako, či sa meria
    v boxe 24 (appka) alebo 100 (master). Plocha trojuholníka sa škáluje s druhou
    mocninou, preto `box²`.
    """
    nodes = geo["nodes"]
    box = geo["box"]
    core = nodes[0]
    angs = sorted(math.degrees(math.atan2(n.y - core.y, n.x - core.x)) % 360
                  for n in nodes[1:])
    gaps = [(angs[(i + 1) % len(angs)] - angs[i]) % 360 for i in range(len(angs))]
    if max(gaps) - min(gaps) < 12.0:
        raise SystemExit(
            f"siet: rozstupy uhlov {[round(g, 1) for g in gaps]} su takmer rovnake "
            "— to je rovnostranny trojuholnik, nie vysek siete")

    a, b, c = nodes[1], nodes[2], nodes[3]
    area = abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2
    floor_area = 0.12 * box * box
    if area < floor_area:
        raise SystemExit(
            f"siet: vedlajsie uzly lezia takmer na priamke (plocha {area:.1f} "
            f"< {floor_area:.1f})")

    for e in geo["edges"]:
        if not e["lat"]:
            continue
        dx, dy = e["x2"] - e["x1"], e["y2"] - e["y1"]
        length = math.hypot(dx, dy)
        ux, uy = dx / length, dy / length
        vx, vy = core.x - e["x1"], core.y - e["y1"]
        t = max(0.0, min(length, vx * ux + vy * uy))
        d = math.hypot(core.x - (e["x1"] + ux * t), core.y - (e["y1"] + uy * t))
        if d < core.outer + geo["edge_w"]:
            raise SystemExit(
                f"siet: bocna hrana prechadza cez jadro (odstup {d:.2f} "
                f"< {core.outer + geo['edge_w']:.2f})")


def assert_edges_readable(geo: dict[str, object], mini: Mini) -> None:
    """Každá hrana musí zostať SPOJENÍM, nie čiarkou pri uzle.

    Meria sa VIDITEĽNÁ stubla (hrana mimo zlatého kotúča jadra), nie geometrická
    dĺžka cesty: prvých 2,6 jednotky hrany od jadra je pod kotúčom a človek ich
    nevidí. Prah je 2,5 × šírka hrany — kalibrácia z oboch strán je pri
    `NET_STUB_FLOOR_RATIO`.
    """
    floor = NET_STUB_FLOOR_RATIO * geo["edge_w"]
    for i, e in enumerate(geo["edges"], 1):
        if e["vis"] < floor:
            raise SystemExit(
                f"siet: z hrany {i} vidno len {e['vis']:.2f} jednotky "
                f"(prah {floor:.2f} = {NET_STUB_FLOOR_RATIO} x sirka hrany) — "
                "to nie je spojenie, ale ciarka pri uzle")


def assert_mini_matches_app(mini: Mini, net: Net) -> None:
    """Stupeň redukcie MUSÍ byť ten istý znak v kánone aj v appke.

    `SIGIL_NET.mini` je mini kánon prepočítaný na viewBox 24. Keď niekto prekreslí
    `hades-sigil-mini.svg` a zabudne na appku (alebo naopak), favicon a rail by
    ukázali dva rôzne redukované znaky — a to je presne ten drift, ktorý sa v tomto
    projekte už dvakrát stal a zaplatil sa hľadaním. Tolerancia 1e-6 je numerická,
    nie vkusová: obe strany počítajú z tých istých pomerov.
    """
    k = Net.BOX / mini.box
    want = (mini.ring_r * k, mini.ring_w * k, mini.core_r * k)
    got = (net.mini_r, net.mini_sw, net.mini_gold)
    if any(abs(a - b) > 1e-6 for a, b in zip(want, got)):
        raise SystemExit(
            "stupen redukcie sa rozisiel: mini SVG dava "
            f"(r {want[0]:.4f}, obrys {want[1]:.4f}, zlato {want[2]:.4f}) vo viewBoxe "
            f"{num(Net.BOX)}, ale SIGIL_NET.mini v {SIGIL_JS.name} nesie "
            f"(r {got[0]:.4f}, obrys {got[1]:.4f}, zlato {got[2]:.4f})")


def assert_same_cutout(geo: dict[str, object], net: Net) -> None:
    """DÔKAZ, že kánon a appka kreslia TEN ISTÝ výsek siete.

    Nie je to tautológia z toho, že `net_geometry()` z appky číta: meria sa
    NORMALIZOVANÝ pomer každej vydanej súradnice k boxu proti pomeru v `SIGIL_NET`.
    Keby niekto do prepočtu vložil offset, iný stred alebo zaokrúhlenie, tento test
    padne — a práve to je celý účel prevzatia kánonu appkou.
    """
    box = geo["box"]
    pairs: list[tuple[str, float, float]] = []
    cx, cy, cr = net.core
    core = geo["nodes"][0]
    pairs += [("jadro cx", core.x / box, cx / Net.BOX),
              ("jadro cy", core.y / box, cy / Net.BOX),
              ("jadro r", core.gold / box, cr / Net.BOX)]
    for i, ((x, y, r, sw), n) in enumerate(zip(net.nodes, geo["nodes"][1:]), 1):
        pairs += [(f"satelit {i} cx", n.x / box, x / Net.BOX),
                  (f"satelit {i} cy", n.y / box, y / Net.BOX),
                  (f"satelit {i} r", n.r / box, r / Net.BOX),
                  (f"satelit {i} obrys", n.w / box, sw / Net.BOX)]
    for i, ((x1, y1, x2, y2), e) in enumerate(zip(net.edges, geo["edges"]), 1):
        pairs += [(f"hrana {i} x1", e["x1"] / box, x1 / Net.BOX),
                  (f"hrana {i} y1", e["y1"] / box, y1 / Net.BOX),
                  (f"hrana {i} x2", e["x2"] / box, x2 / Net.BOX),
                  (f"hrana {i} y2", e["y2"] / box, y2 / Net.BOX)]
    pairs.append(("sirka hrany", geo["edge_w"] / box, net.edge_sw / Net.BOX))

    bad = [(name, a, b) for name, a, b in pairs if abs(a - b) > 1e-9]
    if bad:
        raise SystemExit("kanon a appka kreslia iny vysek: " + "; ".join(
            f"{name} {a:.9f} != {b:.9f}" for name, a, b in bad))
    return len(pairs)


def assert_emitted_matches_app(master: str, net: Net) -> tuple[int, float]:
    """To isté meranie, ale na VYDANOM súbore — nie na modeli v pamäti.

    `assert_same_cutout()` overuje prepočet, tento overuje ZÁPIS. Rozdiel je
    zaplatiteľný: `num()` reže na dve desatiny, takže súradnica v SVG nie je pomer
    z appky, ale jeho zaokrúhlenie (6,27/24 = 0,261250 proti 26,12/100 = 0,261200).
    Bez tejto polovice by sa dalo tvrdiť „pomery sedia" o čísle, ktoré v súbore nie
    je. Tolerancia je odvodená zo zaokrúhlenia (0,005 boxu), nie vymyslená — a je
    to zároveň strop, koľko zaokrúhlenie SMIE ukrojiť.
    """
    tol = 0.005 / 100.0
    box = float(re.search(r'viewBox="0 0 (\d+(?:\.\d+)?)', master).group(1))
    want: list[tuple[str, float]] = []
    for i, (x1, y1, x2, y2) in enumerate(net.edges, 1):
        want += [(f"hrana {i} x1", x1), (f"hrana {i} y1", y1),
                 (f"hrana {i} x2", x2), (f"hrana {i} y2", y2)]
    for i, (x, y, r, _sw) in enumerate(net.nodes, 1):
        want += [(f"satelit {i} cx", x), (f"satelit {i} cy", y), (f"satelit {i} r", r)]
    cx, cy, cr = net.core
    want += [("jadro cx", cx), ("jadro cy", cy), ("jadro r", cr)]

    got = [float(v) for v in re.findall(
        r'(?:x1|y1|x2|y2|cx|cy|r)="(-?\d+(?:\.\d+)?)"', master)]
    if len(got) != len(want):
        raise SystemExit(
            f"vydany master nesie {len(got)} suradnic, cakal som {len(want)} — "
            "zmenil sa markup, nie geometria")
    worst = 0.0
    bad = []
    for (name, w), g in zip(want, got):
        diff = abs(g / box - w / Net.BOX)
        worst = max(worst, diff)
        if diff > tol:
            bad.append(f"{name} {g / box:.6f} != {w / Net.BOX:.6f}")
    if bad:
        raise SystemExit("vydany master kresli iny vysek: " + "; ".join(bad))
    return len(want), worst


def ladder(mini: Mini, geo: dict[str, object]) -> list[dict[str, object]]:
    """Stupne redukcie s NAMERANÝMI šírkami v px.

    Nie je to tabuľka podľa vkusu: pre každý stupeň sa spočíta najtenší obrys
    aj najkratšia viditeľná stubla v skutočných pixeloch. Prah `NET_MIN_PX` je
    STUBLOVÝ (pod 32 px má najkratšia stubla 3,5 px a znak prestane hovoriť „sieť"),
    takže stĺpec obrysu je kalibrácia druhým smerom — a 32 px riadok ju o 0,03 px
    NESPLNÍ. To sa priznáva, nezaokrúhľuje.
    """
    rows = []
    for px in (16, 24, 32, 48, 64, 128, 256):
        k = px / mini.box
        ring_thin = min([n.w for n in geo["nodes"] if not n.is_core]
                        + [geo["edge_w"]]) * k
        stub_thin = min(e["vis"] for e in geo["edges"]) * k
        if px >= NET_MIN_PX:
            row = {"px": px, "stage": "sieť · prstence", "thinnest": ring_thin,
                   # 3 satelity + 4 hrany + zlaté jadro
                   "shapes": len(geo["nodes"]) + len(geo["edges"])}
        else:
            row = {"px": px, "stage": "jeden uzol", "thinnest": mini.ring_w * k,
                   "shapes": 2}
        row["ok"] = row["thinnest"] >= RING_LW_FLOOR_PX
        row["ring_thinnest"] = ring_thin
        row["stub_thinnest"] = stub_thin
        rows.append(row)
    return rows


def build_master(mini: Mini) -> str:
    """Master = výsek siete, prepočítaný zo `SIGIL_NET` na box mini."""
    geo = net_geometry(mini)
    assert_optical(geo)
    assert_edges_readable(geo, mini)
    assert_same_cutout(geo, net_canon())
    nodes, edges = geo["nodes"], geo["edges"]
    core = nodes[0]
    nl = newline_of(read(MINI_SRC))
    box = num(mini.box)

    edge_lines = []
    for e in edges:
        cls = ' class="lat"' if e["lat"] else ""
        edge_lines.append(
            f'    <line x1="{num(e["x1"])}" y1="{num(e["y1"])}" '
            f'x2="{num(e["x2"])}" y2="{num(e["y2"])}" '
            f'stroke-width="{num(geo["edge_w"])}"{cls}/>')

    sat_lines = [
        f'  <circle cx="{num(n.x)}" cy="{num(n.y)}" r="{num(n.r)}" '
        f'stroke-width="{num(n.w)}"/>'
        for n in nodes[1:]
    ]

    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {box} {box}" role="img" aria-label="Hades">',
        "  <title>Hades</title>",
        "  <!-- GENEROVANÉ tools/brand/build-mark.py — needituj ručne. Geometria siete je",
        "       prepočet SIGIL_NET z public/js/shared/sigil.js (viewBox 24) na tento box;",
        "       farby a stupeň redukcie sú z hades-sigil-mini.svg. -->",
        "  <style>",
        f"    svg {{ --acc: {mini.acc_light}; --gold: {mini.gold_light}; }}",
        f"    @media (prefers-color-scheme: dark) {{ svg {{ --acc: {mini.acc_dark}; --gold: {mini.gold_dark}; }} }}",
        "    circle, line { stroke: var(--acc); stroke-linecap: round; fill: none; }",
        "    .edges line { opacity: .8; }",
        "    .edges .lat { opacity: .5; }",
        "    .gold-fill { fill: var(--gold); stroke: none; }",
        "  </style>",
        "  <!-- HRANY sa kreslia PRVÉ, aby uzly stáli na nich, nie naopak. Tri idú zo",
        "       STREDU jadra (tam sú skryté pod jeho plným kotúčom), štvrtá je chorda",
        "       medzi dvoma satelitmi a jadro OBCHÁDZA — bez nej je to hviezda, nie sieť.",
        "       Bočná hrana (.lat) je slabšia: jadro musí zostať tým, na čo sa sieť viaže. -->",
        '  <g class="edges">',
        *edge_lines,
        "  </g>",
        "  <!-- SATELITY: prstence bez výplne (priehľadnosť nesie diera, nie alfa).",
        f"       Rovnako veľké, v nepravidelných uhloch. Pod {NET_MIN_PX} px zmiznú spolu s hranami. -->",
        *sat_lines,
        "  <!-- JADRO: jediný sýty PLNÝ prvok celého znaku a je ZLATÝ. Amethystový prstenec",
        "       okolo neho tu do 2. 9. 2026 bol a je RETIROVANÝ (rozhodnutie: vyhráva appka):",
        "       štvrtý prstenec by z jadra urobil štvrtý uzol a „jediný sýty\" by prestalo platiť. -->",
        f'  <circle cx="{num(core.x)}" cy="{num(core.y)}" r="{num(core.gold)}" class="gold-fill"/>',
        "</svg>",
        "",
    ]
    return nl.join(lines)


# --------------------------------------------------------------------------- #
# 7. lockupy — znak + wordmark
# --------------------------------------------------------------------------- #

LOCKUPS = ("hades-lockup-h.svg", "hades-lockup-v.svg")


def scope_sigil(master: str) -> str:
    """Telo mastera so štýlmi zapuzdrenými pod `.sig`.

    Bez zapuzdrenia by `path { fill: none; stroke: ... }` zo znaku ušlo na písmo
    lockupu a wordmark by sa vykreslil obtiahnutý namiesto vyplneného. Logika je
    portovaná z `docs/build-brand.py`, ktorý v tejto vetve UŽ NEEXISTUJE — a to
    bol presne dôvod, prečo lockupy nesli geometriu starého mastera (r 34, jadro
    r 8,5) ešte dlho po tom, ako sa master zmenil. Assety bez generátora zastarajú.
    """
    inner = re.sub(r"^<svg[^>]*>|</svg>$", "", master.strip(), flags=re.S)
    inner = re.sub(r"<title>.*?</title>", "", inner, flags=re.S)

    def scope_rules(css: str) -> str:
        out = []
        for rule in re.findall(r"[^{}]+\{[^{}]*\}", css, flags=re.S):
            sel, body = rule.split("{", 1)
            sels = ", ".join((".sig" if p.strip() == "svg" else ".sig " + p.strip())
                             for p in sel.split(",") if p.strip())
            out.append(sels + "{" + body)
        return "".join(out)

    def scope(m: "re.Match[str]") -> str:
        css = m.group(1)
        out = []
        for chunk in re.findall(r"@media[^{]*\{.*?\}\s*\}|[^{}]+\{[^{}]*\}", css, flags=re.S):
            if chunk.strip().startswith("@media"):
                head, inner_css = chunk.split("{", 1)
                out.append(head + "{" + scope_rules(inner_css.rsplit("}", 1)[0]) + "}")
            else:
                out.append(scope_rules(chunk))
        return "<style>" + "".join(out) + "</style>"

    return re.sub(r"<style>(.*?)</style>", scope, inner, flags=re.S)


def build_lockups(master: str) -> None:
    """Vymení SKUPINU `.sig` v hotových lockupoch, wordmark nechá na mieste.

    Prečo výmena a nie prestavba celého lockupu: umiestnenie wordmarku (pomer
    1,55 : 1 k výške verzálky, medzera 0,34 × výška znaku) vypočítal retirovaný
    `docs/build-brand.py` z metrík fontu Cinzel, ktorý v repe nie je. Prestavba
    by tie čísla musela odhadnúť z viewBoxu wordmarku — zmerané, vyšla by šírka
    327 namiesto 312, teda by sa lockup posunul bez toho, aby to niekto chcel.
    Výmena tela znaku je presne tá zmena, ktorá sa udiala.
    """
    body = scope_sigil(master)
    for name in LOCKUPS:
        path = BRAND / name
        if not path.exists():
            raise SystemExit(f"lockup {name} chýba — nemám čo aktualizovať")
        src = read(path)
        open_m = re.search(r'<g class="sig"[^>]*>', src)
        if not open_m:
            raise SystemExit(f"lockup {name}: nenašiel som skupinu .sig")
        # VYVÁŽENÉ párovanie <g>, nie `.*?</g>`: master nesie vnorenú skupinu
        # <g class="ticks">, takže nenásytný regex skončil na JEJ zatváracej
        # značke a v súbore zostali oba znaky naraz — zmerané, v lockupe boli
        # súčasne r 34 aj r 47. Nenásytnosť je tu chyba, nie optimalizácia.
        i = open_m.end()
        depth = 1
        while depth:
            nxt = re.search(r"<g\b|</g>", src[i:])
            if not nxt:
                raise SystemExit(f"lockup {name}: skupina .sig nie je uzavretá")
            depth += 1 if nxt.group(0) == "<g" else -1
            i += nxt.end()
        close_at = i - len("</g>")
        nl = newline_of(src)
        emit(path, src[:open_m.end()] + nl + "  " + body.strip() + nl + "  " + src[close_at:])


def main() -> int:
    mini = Mini(read(MINI_SRC))
    net = net_canon()
    # Stráž PRED prvým výstupom: keď sa stupeň redukcie rozišiel, nemá zmysel vydať
    # sedem assetov a až potom to zistiť z DERIVED.md.
    assert_mini_matches_app(mini, net)
    ink = dark_paper_hex()
    d = derived(mini)

    # Poradie je väzba, nie zvyk: master sa VYDÁ z mini, a mono aj lockupy sa
    # potom čítajú z hotového mastera. Keby sa mono skladalo skôr, nesie o beh
    # starú kresbu — presne tak zostarli lockupy.
    emit(MASTER_SRC, build_master(mini))
    master = read(MASTER_SRC)
    # Meranie na VYDANOM súbore ide do DERIVED.md, nie len do stdout: dokument má
    # niesť dôkaz o tom, čo je v repe, nie o tom, čo bolo v pamäti.
    d["emitted_n"], d["emitted_worst"] = assert_emitted_matches_app(master, net)
    emit(BRAND / "hades-sigil-mono.svg", build_mono(master))
    build_lockups(master)
    emit(BRAND / "hades-favicon.svg", favicon_svg(mini, ink))
    uri = favicon_data_uri(mini, ink)
    # Stráž PRED zápisom: keď je pravda rozdvojená, generátor nemá čo prepisovať —
    # prepísaný partial pri stray kópii by bol práve ten tichý drift.
    assert_partial_is_only_truth()
    patch_icon_partial(uri)
    build_icos(mini, ink)
    build_electron_html(mini)
    build_derived_md(mini, ink, uri, d)

    geo = net_geometry(mini)
    print(f"zdroj siete: {SIGIL_JS.relative_to(ROOT).as_posix()} "
          f"(SIGIL_NET, viewBox {num(Net.BOX)}) — 3 satelity, {len(net.edges)} hrany, "
          f"bocna hrana #{net.lat_index + 1}")
    print(f"zdroj uzla:  {MINI_SRC.relative_to(ROOT).as_posix()} "
          f"(prstenec r{num(mini.ring_r)}/{num(mini.ring_w)}, jadro r{num(mini.core_r)}) "
          f"= SIGIL_NET.mini r{num(net.mini_r)}/{num(net.mini_sw)}/{num(net.mini_gold)}")
    print(f"vysek (model): {assert_same_cutout(geo, net)} normalizovanych pomerov "
          f"zhodnych do 1e-9 (kanon box {num(mini.box)} vs appka box {num(Net.BOX)})")
    print(f"vysek (vydany master): {d['emitted_n']} pomerov, najhorsi rozdiel "
          f"{d['emitted_worst']:.6f} boxu (strop zaokruhlenia 0.000050)")
    print("stubla hran (vidno): "
          + " / ".join(f"{e['vis']:.2f}" for e in geo["edges"])
          + f" · prah siete {NET_MIN_PX} px")
    print(f"ico: {ICO_SIZES}")
    for rel in WRITTEN:
        print(("DRY " if DRY else "") + "zapísané: " + rel)
    for rel in UNCHANGED:
        print("bez zmeny: " + rel)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
