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
  * public/brand/hades-sigil-mini.svg  — KÁNON JEDNÉHO UZLA: prstenec r36/hrúbka 9,
    zlatý stred r15
  * public/css/mind.css                — tmavý papier (`--bg-rgb`) pod faviconom

ZNAK JE OD 1. 9. 2026 SIEŤ (rozhodnutie používateľa): jadrový uzol a tri vedľajšie,
viazané štyrmi hranami. Prstencový znak „Jedno oko" (nosný prstenec, prerušenie,
satelit, obežnica, delenia po 30°) je retirovaný a jeho slovník sa NEPREKLÁDA.

Master (hades-sigil.svg) sa od 28. 8. 2026 GENERUJE z mini a ručným zdrojom už NIE
JE. Dovtedy to boli dva nezávislé výkresy a rozišli sa: master mal nosný prstenec
0,46 boxu, mini 0,36 — znak vedľa znaku teda nesúhlasil. Master si z mini berie
POMERY (0,36 / 0,09 / 0,30 boxu) a stavia z nich jadrový uzol siete; v sieti sa
absolútna identita udržať nedá, pretože prstenec r 36 v strede nenechá vedľajším
uzlom miesto. Konštanty siete sú NET_* nižšie.

REBRÍK REDUKCIE je súčasť znaku, nie jeho dokumentácia: pod NET_MIN_PX (128) padnú
obrysy vedľajších uzlov a hrany pod 1,5 px, takže sa kreslí MINI — jeden uzol.
`ladder()` to prepočítava z geometrie a vypisuje do DERIVED.md aj s kalibráciou
opačným smerom (koľko by sieť merala, keby sa na tom stupni kreslila).

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

# Box načítavacej značky (`.load-mark`) je 26 px a NIE JE to odvodené z kánonu:
# je to hodnota vybraná pre kontrast (prstenec je jediný nositeľ informácie
# „pracujem", takže musí sám držať 3:1). Preto je to vstup generátora, nie výstup —
# ostatné dve čísla sa z neho už počítajú kánonickými pomermi.
LOAD_MARK_BOX_PX = 26
LOAD_MARK_MIN_STROKE_PX = 2   # pod 2 px zoberie antialiasing viac než polovicu obrysu

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
    hrany aj obrysy vedľajších uzlov by mali pod 0,4 px (viď `ladder()`).
    """
    n = px * SUPERSAMPLE
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = n / mini.box

    def disc(x: float, y: float, r: float, color: str) -> None:
        d.ellipse([x * s - r * s, y * s - r * s, x * s + r * s, y * s + r * s], fill=color)

    disc(mini.cx, mini.cy, mini.disk_r, ink)

    if px < NET_DISC_MIN_PX:
        disc(mini.cx, mini.cy, mini.ring_r + mini.ring_w / 2, mini.acc_dark)
        disc(mini.cx, mini.cy, mini.ring_r - mini.ring_w / 2, ink)
        disc(mini.cx, mini.cy, mini.core_r, mini.gold_dark)
        return img.resize((px, px), Image.LANCZOS)

    geo = net_geometry(mini)
    if px < NET_MIN_PX:
        # DISKOVÝ stupeň: hrany od stredu k stredu (disky im zakryjú konce),
        # uzly plné. To isté, čo generátor vkladá do offline stavu Electronu.
        layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        rgb = tuple(int(mini.acc_dark[i:i + 2], 16) for i in (1, 3, 5))
        nodes = geo["nodes"]
        for a, b, lat in NET_EDGES:
            na, nb = nodes[a], nodes[b]
            ld.line([na.x * s, na.y * s, nb.x * s, nb.y * s],
                    fill=rgb + (round(255 * (0.5 if lat else 0.8)),),
                    width=max(1, round(NET_DISC_EDGE_W * s)))
        img = Image.alpha_composite(img, layer)
        d = ImageDraw.Draw(img)
        for node in nodes[1:]:
            disc(node.x, node.y, node.outer, mini.acc_dark)
        core = nodes[0]
        disc(core.x, core.y, core.r, mini.gold_dark)
        return img.resize((px, px), Image.LANCZOS)

    # Hrany pred uzlami — to isté poradie ako v SVG. Zárez hrán je TÁ ISTÁ
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
                width=max(1, round(NET_EDGE_W * s)))
    img = Image.alpha_composite(img, layer)
    d = ImageDraw.Draw(img)
    for node in geo["nodes"]:
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
      * offline stav má 84 px     -> SIEŤ v diskovom stupni (obrys by pri 84 px mal
        1,13 px, teda pod podlahou 1,5 px — preto disky, nie prstence).

    Kontrakt tried NEVYMÝŠĽAM: `.edge` / `.nodes` > `.node` / `.core` už v offline
    dokumente sú a visí na nich jeho pohyb, ktorý stojí ZÁMERNE MIMO markerov.
    Generátor preto dodáva len geometriu a základnú kresbu — presne tú deľbu, akú
    ten dokument sám opisuje. `.nodes` musí mať PRESNE tri deti: stupňovanie zrodu
    ide cez `:nth-child(2)` / `(3)`.

    `pathLength="100"` na každej hrane je povinné: hrany sú rôzne dlhé, takže jedna
    konštanta `stroke-dasharray: 100` bez normalizácie dokreslí jednu a ostatné
    zastaví v polovici.

    POZOR (zapísané 1. 9. 2026): tento región je generátorov, ale plocha appky
    (`.bc-mark` v mind.css a Blade) má od tej istej vlny VLASTNÚ sieť s inými
    súradnicami, ktorú vydal niekto iný. Kým sa to nezjednotí, electron a plocha
    kreslia dva rôzne výseky tej istej siete — je to zapísané v DERIVED.md ako
    otvorený bod, nie zamlčané.
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
                  f"           NET_DISC_MIN_PX ({NET_DISC_MIN_PX}) — hrany by sa zliali. Znak tu nesie rolu „desktop okno\"\n"
                  "           (identita appky v ráme, ktorý nie je prehliadač), preto sa NEANIMUJE —\n"
                  "           pulz behu patrí #brand-core. -->"
                  + topbar)

    geo = net_geometry(mini)
    nodes = geo["nodes"]
    core = nodes[0]
    # Diskový stupeň: hrany sa kreslia od STREDU k STREDU a konce im zakryjú disky.
    # Zárez by tu nechal viditeľnú medzeru (1,5 jednotky = 1,26 px na 84 px), takže
    # by vznikli presne tie pahýle, ktorým sa zárez v prstencovom stupni vyhýba.
    edge_lines = []
    for a, b, lat in NET_EDGES:
        na, nb = nodes[a], nodes[b]
        cls = "edge edge--lat" if lat else "edge"
        edge_lines.append(
            f'            <path class="{cls}" pathLength="100" '
            f'd="M {num(na.x)} {num(na.y)} L {num(nb.x)} {num(nb.y)}"></path>')
    node_lines = [
        f'                <circle class="node" cx="{num(n.x)}" cy="{num(n.y)}" '
        f'r="{num(n.outer)}"></circle>'
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
        f'r="{num(core.r)}"></circle>',
        "        </svg>",
        "        ",
    ])
    patch_between(off, "<!-- ZNAK: generuje", "<!-- /ZNAK -->",
                  " tools/brand/build-mark.py — needituj ručne.\n"
                  "             SIEŤ v DISKOVOM stupni (`.sigil` je 84 px). Súradnice sú kánon\n"
                  "             z hades-sigil-mini.svg + NET_* konštánt generátora, nie ručná kresba.\n"
                  "             Hrany idú od stredu k stredu a konce im zakryjú disky — žiadne pahýle.\n"
                  "             `.nodes` musí obsahovať PRESNE tri uzly: zrod ide cez :nth-child(2)/(3). -->"
                  + markup)

    style = "\n".join([
        "",
        "        .sigil .edge { fill: none; stroke: var(--accent); "
        f"stroke-width: {num(NET_DISC_EDGE_W)}; stroke-linecap: round; opacity: .8; }}",
        "        .sigil .edge--lat { opacity: .5; }",
        "        .sigil .node { fill: var(--accent); }",
        f"        .sigil .core {{ fill: var(--gold); transform-origin: {num(mini.cx)}px {num(mini.cy)}px; }}",
        "        ",
    ])
    patch_between(off, "/* ZNAK-STYLE: generuje", "/* /ZNAK-STYLE */",
                  " tools/brand/build-mark.py zo hades-sigil-mini.svg.\n"
                  "           Needituj ručne — pri najbližšom behu generátora sa zmena stratí.\n"
                  "           Dôvod, prečo je geometria aj tu: tento dokument sa zobrazuje, KEĎ SERVER\n"
                  "           NEBEŽÍ, takže nemôže načítať mind.css ani nič z public/.\n"
                  "           ZNAK JE SIEŤ (1. 9. 2026): prstenec (`.ring`) je retirovaný — v sieti nie je\n"
                  "           zavretá krivka, ktorú by pomenoval. Uzly sú tu PLNÉ DISKY, nie prstence:\n"
                  f"           pri 84 px by obrys uzla mal {min(n.w for n in nodes) * 0.84:.2f} px, "
                  f"teda pod podlahou {num(RING_LW_FLOOR_PX)} px. */"
                  + style)


# --------------------------------------------------------------------------- #
# 7. odvodené čísla pre súbory, ktoré generátor nevlastní
# --------------------------------------------------------------------------- #

def derived(mini: Mini) -> dict[str, object]:
    scale = BLADE_VIEWBOX / mini.box
    ring_r = mini.ring_r * scale
    d = {
        "blade_ring_r": ring_r,
        "blade_stroke": mini.ring_w * scale,
        "blade_core_r": mini.core_r * scale,
        "dasharray": 2 * 3.141592653589793 * ring_r,
        "lm_box": LOAD_MARK_BOX_PX,
        # Obrys: kánonický pomer, ale s podlahou 2 px — pod ňou zoberie
        # antialiasing viac než polovicu kontrastu a prstenec prestane držať 3:1.
        "lm_border": max(LOAD_MARK_MIN_STROKE_PX,
                         round(LOAD_MARK_BOX_PX * mini.stroke_ratio)),
        # Jadro: kánonický pomer priemeru, zaokrúhlený na celý pixel (26 × 0,3 = 7,8).
        "lm_core": round(LOAD_MARK_BOX_PX * mini.core_diameter_ratio),
    }
    # Stredný polomer prstenca .load-mark NIE JE 0,36 boxu a nie je to preklep:
    # `border` v CSS rastie dovnútra boxu, takže polomer je daný boxom a obrysom.
    d["lm_ring_ratio"] = (LOAD_MARK_BOX_PX - d["lm_border"]) / 2 / LOAD_MARK_BOX_PX
    return d


def blade_inline_svg(mini: Mini, d: dict[str, object]) -> str:
    # Kánon akcentu: prstenec je AMETHYST (interaktívny nosič), jadro ZLATÉ
    # (značka). Nie naopak a nie oboje zlaté — zlatá je vyhradená jadru, inak sa
    # ten jeden vyhradený význam rozdrobí.
    c = num(BLADE_VIEWBOX / 2)
    return (
        f'<svg viewBox="0 0 {BLADE_VIEWBOX} {BLADE_VIEWBOX}" '
        f'width="{BLADE_VIEWBOX}" height="{BLADE_VIEWBOX}" aria-hidden="true">\n'
        f'    <circle class="bc-ring" cx="{c}" cy="{c}" r="{num(d["blade_ring_r"])}" '
        f'fill="none" stroke="var(--accent)" stroke-width="{num(d["blade_stroke"])}"/>\n'
        f'    <circle class="bc-core" cx="{c}" cy="{c}" r="{num(d["blade_core_r"])}" '
        f'fill="var(--brand-gold)"/>\n'
        "</svg>"
    )


def net_inline_svg(geo: dict[str, object], mini: Mini) -> str:
    """Inline sieťový znak pre plochy, ktoré ho majú NIESŤ V DOM (nie ako obrázok).

    Existuje preto, že `.load-mark` v mind.css je CSS `border` — a rámom sa dá
    nakresliť kruh, nie zhluk uzlov. Sieť teda potrebuje iný nosič a jediný, ktorý
    vie animovať jednotlivé uzly a hrany, je inline SVG.

    Triedy sú `bn-*` (brand net), NIE `bc-*`: `bc-ring` / `bc-core` nesie inline
    znak v Blade, ktorý zostáva JEDNÝM UZLOM, a mind.css naň už vešia `bc-draw`.
    Rovnaké meno pre dva rôzne výkresy je presne ten drift, kvôli ktorému tento
    generátor vznikol.
    """
    box = num(mini.box)
    out = [f'<svg viewBox="0 0 {box} {box}" class="bn" aria-hidden="true">',
           '  <g class="bn-edges">']
    for i, e in enumerate(geo["edges"], 1):
        cls = "bn-edge bn-edge--lat" if e["lat"] else "bn-edge"
        out.append(
            f'    <line class="{cls}" data-len="{e["len"]:.2f}" '
            f'x1="{num(e["x1"])}" y1="{num(e["y1"])}" '
            f'x2="{num(e["x2"])}" y2="{num(e["y2"])}" '
            f'stroke-width="{num(NET_EDGE_W)}" style="--bn-len: {e["len"]:.2f}; '
            f'--bn-i: {i}"/>')
    out.append("  </g>")
    for i, n in enumerate(geo["nodes"][1:], 1):
        out.append(f'  <circle class="bn-node" cx="{num(n.x)}" cy="{num(n.y)}" '
                   f'r="{num(n.r)}" stroke-width="{num(n.w)}" style="--bn-i: {i}"/>')
    core = geo["nodes"][0]
    out.append(f'  <circle class="bn-node bn-node--core" cx="{num(core.x)}" '
               f'cy="{num(core.y)}" r="{num(core.r)}" stroke-width="{num(core.w)}"/>')
    out.append(f'  <circle class="bn-core" cx="{num(core.x)}" cy="{num(core.y)}" '
               f'r="{num(core.gold)}"/>')
    out.append("</svg>")
    return "\n".join(out)


def build_derived_md(mini: Mini, ink: str, uri: str, d: dict[str, object]) -> None:
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

## Pre `public/css/mind.css` (vlastní A3)

```css
/* Obvod prstenca = 2π × {num(d["blade_ring_r"])} = {d["dasharray"]:.2f} — DERIVÁT POLOMERU
   z tools/brand/build-mark.py, nie ručná konštanta. Keď sa zmení zdroj znaku,
   prepočíta ho generátor a vypíše sem. */
stroke-dasharray: {d["dasharray"]:.2f};
stroke-dashoffset: {d["dasharray"]:.2f};
```

`.load-mark` — tri čísla. Box {d["lm_box"]} px je **vstup** (hodnota vybraná pre
kontrast, komentár nad pravidlom to vysvetľuje pravdivo), ostatné dve sú z neho
odvodené kánonickými pomermi:

```css
width: {d["lm_box"]}px; height: {d["lm_box"]}px;
border: {d["lm_border"]}px solid var(--accent);
/* jadro */
width: {d["lm_core"]}px; height: {d["lm_core"]}px; margin: -{d["lm_core"] // 2}px 0 0 -{d["lm_core"] // 2}px;
```

Stredný polomer prstenca vyjde {d["lm_ring_ratio"]:.4f} boxu, nie
{mini.ring_ratio:.4f} ako v kánone. **Nie je to drift:** CSS `border` rastie
dovnútra boxu, takže polomer je funkcia boxu a obrysu, nie voľné číslo. Prepísať
ho na 1 : 1 s kánonom by znamenalo zmenšiť box a stratiť kontrast.

## Pre Blade markup — RETIROVANÉ (jeden uzol vo viewBoxe {BLADE_VIEWBOX})

Tento blok bol kánonom, kým bol znak prstenec. Od 1. 9. 2026 je znak **sieť** a
inline znak v Blade nesie sieť z diskov s triedami `bc-node` / `bc-edge` / `bc-core`
(vlastní `mind.css` a Blade, nie tento generátor). Blok tu zostáva pre **jeden uzol**,
lebo to je stále kresba pod {NET_DISC_MIN_PX} px — a `.load-mark`, favicon aj
Electron topbar ju používajú.

Na **jadre** je `fill="var(--brand-gold)"` kánon; `currentColor` sa opúšťa — sú to
dva mechanizmy a jeden zanikne pri prvej zmene farby. **Prstenec** je
`var(--accent)`: amethyst je interaktívny nosič, zlatá je vyhradená jadru.

```html
{blade_inline_svg(mini, d)}
```

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

    lad = "\n".join(
        f'| {r["px"]} px | {r["stage"]} | {r["thinnest"]:.2f} px | '
        f'{r["ring_thinnest"]:.2f} px | {r["disc_thinnest"]:.2f} px | {r["shapes"]} | '
        f'{"drží" if r["ok"] else "PADÁ"} |'
        for r in rows)

    md += f"""
## Nový znak: SIEŤ (1. 9. 2026)

Znak je **výsek siete**: jadrový uzol a tri vedľajšie uzly, viazané štyrmi hranami
(tri od jadra + jedna bočná). Prstencový znak „Jedno oko" je retirovaný a jeho
slovník sa neprekladá — v sieti nemá čo pomenovať.

| Uzol | stred | prstenec | obrys | vlastný box |
|---|---|---|---|---|
| jadro | {num(core.x)}, {num(core.y)} | r {num(core.r)} | {num(core.w)} | {num(NET_CORE_BOX)} |
""" + "".join(
        f"| vedľajší {i} | {num(n.x)}, {num(n.y)} | r {num(n.r)} | {num(n.w)} | "
        f"{num(NET_SATS[i - 1][2])} |\n"
        for i, n in enumerate(sats, 1)) + f"""
Zlatý stred jadra: r {num(core.gold)}. Hrany: šírka {num(NET_EDGE_W)}, zárez
{num(NET_EDGE_GAP)} pred obrubou uzla, bočná hrana na {int(0.5 * 100)} % krytia proti
{int(0.8 * 100)} % u hrán od jadra.

**Kompozícia je optická, nie mriežková, a generátor si to VYNUCUJE**
(`assert_optical()`): rozstupy uhlov vedľajších uzlov vyšli
{gaps[0]:.0f}° / {gaps[1]:.0f}° / {gaps[2]:.0f}° — teda ani rovnostranný trojuholník
(3 × 120°), ani úsečka. Tri rôzne veľkosti uzlov nesú hĺbku susedstva. Keby niekto
zmenil jedno číslo v `NET_SATS` tak, že kompozícia sadne do mriežky, **generátor
padne** namiesto toho, aby vydal mriežkový znak.

## Stupne redukcie — namerané, nie odhadnuté

Podlaha kontrastu obrysu je **{RING_LW_FLOOR_PX} px** (CLAUDE.md, „Vizuálna sémantika":
pri 1,1 px zoberie antialiasing viac než polovicu kontrastu). Rebrík má **tri**
stupne, nie dva, a ten tretí som pri prvom návrhu vynechal: podlaha platí na
**obrys**, a uzol nakreslený ako plný disk obrys nemá. Sieť z diskov preto drží
hlboko pod {NET_MIN_PX} px — v diskovom stupni rozhoduje najtenší prvok, ktorý tam
zostal, teda **hrana**.

Stĺpce „prstence by mali" a „disky by mali" sú kalibrácia opačným smerom: koľko by
meral najtenší prvok toho stupňa, keby sa kreslil aj na tejto veľkosti. Bez tej
polovice sa nedá poznať, či sú {NET_MIN_PX} a {NET_DISC_MIN_PX} namerané hranice,
alebo len prvé vyskúšané čísla.

| px | čo sa kreslí | najtenší prvok | prstence by mali | disky by mali | tvarov | podlaha |
|---|---|---|---|---|---|---|
{lad}

Čo presne na ktorom stupni **zmizne**:

* **16 px, 24 px, 32 px** — jeden uzol: amethystový prstenec, zlatý stred. Hrany aj
  vedľajšie uzly sú zatvorené. Toto je stupeň faviconu (`hades-favicon.svg`,
  data-URI, rámce `.ico` 16–32) a Electron topbaru (`.sigil` 16 px). Pri 32 px by
  hrana v diskovom stupni mala {rows[2]["disc_thinnest"]:.2f} px, teda pod podlahou —
  preto ani tu ešte nie je sieť.
* **48 px, 64 px** — **sieť z plných diskov**. Prstence tu nejdú: najtenší obrys uzla
  by mal {rows[3]["ring_thinnest"]:.2f}–{rows[4]["ring_thinnest"]:.2f} px. Disk stratí
  „priehľadnosť nesie diera", a je to správny ústupok: diera tejto veľkosti by aj tak
  zanikla. Zmizne obruba uzla a amethystový prstenec okolo jadra; zostanú štyri hrany,
  tri amethystové disky a zlaté jadro.
* **128 px a viac** — **sieť z prstencov**, plný kánon: hrany
  {rows[5]["disc_thinnest"] / NET_DISC_EDGE_W * NET_EDGE_W:.2f} px, najtenší obrys uzla
  {rows[5]["ring_thinnest"]:.2f} px, jadro ako prstenec so sýtym zlatým stredom.
  Nezmizne nič.

**Riadok 16 px hlási PADÁ a je to priznanie, nie chyba tabuľky.** Obrys jedného uzla
má pri 16 px {mini.ring_w * 0.16:.2f} px, teda pod podlahou {RING_LW_FLOOR_PX} px.
Vykreslený rámec je čitateľný (`.ico` sa rastruje {SUPERSAMPLE}× nadvzorkovane
a LANCZOSom), takže to nie je porucha, ktorú by bolo vidieť — ale číslo je pod
podlahou a zamlčať sa nemá. Oprava by bola hrúbka prstenca **10 namiesto 9**
({0.10 * 16:.2f} px pri 16 px), a NEUROBILA SA zámerne: mini kánon nesie aj
`.load-mark` (`border` {d["lm_border"]} px) a inline znak v Blade, teda súbory, ktoré
tento generátor nevlastní. Je to zmena pomeru, nie kozmetika — patrí do jedného
rozhodnutia so spodným bodom nižšie.

Dôsledok pre `.ico`: multi-size ikona nesie **tri rôzne výkresy** (16–32 jeden uzol,
48–64 sieť z diskov, 128–256 sieť z prstencov). Presne na to multi-size `.ico` je;
jeden škálovaný výkres by buď na 16 px zamrzol do kaše, alebo na 256 px stratil sieť.

## Nosiče znaku a `.load-mark` — čo kam patrí

Načítavacia značka `.load-mark` je CSS `border` na boxe {LOAD_MARK_BOX_PX} px. Rámom
sa dá nakresliť kruh, **zhluk uzlov nie** — sieť teda na tom nosiči vyjadriť nemožno
a potrebuje inline SVG. Zároveň platí druhá vec: {LOAD_MARK_BOX_PX} px je pod
{NET_DISC_MIN_PX} px, takže na tomto nosiči je **správna kresba jeden uzol**. Obe
tvrdenia platia naraz a nie sú v spore — a preto tu `border` môže zostať.

| nosič | veľkosť | stupeň | poznámka |
|---|---|---|---|
| `<link rel="icon">` data-URI | 16–32 px | jeden uzol | `hades-favicon.svg`, spravuje generátor |
| Electron topbar `.sigil` | 16 px | jeden uzol | generátor, medzi ZNAK markermi |
| `.load-mark` | {LOAD_MARK_BOX_PX} px | jeden uzol | CSS `border` stačí, čísla nižšie sú nezmenené |
| inline znak v Blade | viewBox {BLADE_VIEWBOX} | **sieť z diskov** | vlastní `mind.css` / Blade, viď otvorený bod |
| Electron offline `.sigil` | 84 px | sieť z diskov | generátor, medzi ZNAK markermi |
| `apple-touch-icon.png` | 180 px | sieť z prstencov | generátor |
| PNG znaku 128/256/512, OG, lockupy | ≥ 128 px | sieť z prstencov | generátor |

## OTVORENÝ BOD (1. 9. 2026): dva výseky tej istej siete

Vlna, ktorá znak prekresľovala, bežala **v dvoch rukách naraz** a každá nakreslila
vlastný výsek. Nie je to zamlčané, pretože presne toto je drift, kvôli ktorému
generátor existuje:

* **Kánon značky** (tento generátor, `public/brand/**`): jadrový uzol v strede
  + tri vedľajšie na {NET_SATS[0][0]:.0f}° / {NET_SATS[1][0]:.0f}° / {NET_SATS[2][0]:.0f}°
  vo vzdialenostiach {NET_SATS[0][1]:.0f} / {NET_SATS[1][1]:.1f} / {NET_SATS[2][1]:.0f}.
  Uzol je nad {NET_MIN_PX} px **prstenec**, jadro má amethystový prstenec so zlatým
  stredom. Electron (oba dokumenty) je z tohto zdroja.
* **Plocha appky** (`.bc-mark` v `mind.css`, markup v troch Blade, viewBox
  {BLADE_VIEWBOX}): vlastné súradnice, uzly **plné disky**, jadro bez amethystového
  prstenca, hrany 8,70 / 9,40 / 8,80 / 10,40 jednotky.

Rozhodnúť treba **jednu** vec: či plocha appky prevezme súradnice z tohto generátora
(potom sa `blade_inline_svg()` prepíše na sieťový výkres a Blade markup sa začne
generovať, ako sa generuje Electron), alebo či generátor prevezme súradnice plochy
(potom sa prekreslia `NET_SATS` a všetkých sedem výstupov). **Kým sa to nerozhodne,
znak v karte prehliadača a znak v raile sú dva rôzne výseky** a `docs/BRAND-HADES.md`
nemá jednu pravdu, ktorú by opísal.

Čo tomu NEPREKÁŽA a netreba meniť: jeden uzol na malých nosičoch je v oboch rukách
tá istá kresba (prstenec r {num(mini.ring_r)} / hrúbka {num(mini.ring_w)}, zlatý
stred r {num(mini.core_r)}), takže favicon, `.ico` do 32 px, topbar a `.load-mark`
sú konzistentné bez ohľadu na to, ako sa spor rozhodne.

## Inline sieť z KÁNONU — PODMIENENÝ blok, implementuj len po rozhodnutí

**Nezavádzaj tento blok, kým sa nerozhodne otvorený bod vyššie.** Plocha appky má
dnes vlastnú živú sieť (`.bc-mark` / `.bc-node` / `.bc-edge` / `.bc-core`) a tretia
rodina tried pre ten istý znak by bola presne ten drift, ktorý má tento generátor
brániť. Blok je tu ako **hotová alternatíva pre variantu „plocha prevezme kánon
značky"**: vtedy sa `bc-*` prekreslí na tieto súradnice a `bn-*` sa zahodí, alebo
sa `bn-*` použije a `bc-*` zmizne — jedno z dvoch, nikdy oboje.

`data-len` aj `--bn-len` na každej hrane je jej **dĺžka po záreze** — presne to
číslo, ktoré potrebuje `stroke-dasharray` na dokreslenie hrany. Ručne sa nepočíta.

```html
{net_inline_svg(geo, mini)}
```

Pohyb (**CSS, nie SMIL** — SMIL nectí `prefers-color-scheme` ani
`prefers-reduced-motion` a vo `<img>`/faviconoch ho prehliadače neanimujú):

```css
.bn .bn-node {{ fill: none; stroke: var(--accent); }}
.bn .bn-edge {{ stroke: var(--accent); stroke-linecap: round; opacity: .8; }}
.bn .bn-edge--lat {{ opacity: .5; }}
.bn .bn-core {{ fill: var(--brand-gold); stroke: none; }}

/* ZROD: uzly sa zjavia -> hrany sa DOKRESLIA -> jadro sa presýti.
   Poradie je obsah, nie ozdoba: sieť vzniká tým, že sa uzly spoja. */
.bn .bn-node {{ animation: bn-node-in 260ms var(--ease) both;
               animation-delay: calc(60ms * var(--bn-i, 0)); }}
.bn .bn-edge {{ stroke-dasharray: var(--bn-len); stroke-dashoffset: var(--bn-len);
               animation: bn-edge-draw var(--dur-chart-draw) var(--ease) both;
               animation-delay: calc(300ms + 80ms * var(--bn-i, 0)); }}
.bn .bn-core {{ animation: bn-core-in 460ms var(--ease) 760ms both; }}

@keyframes bn-node-in {{ from {{ opacity: 0; transform: scale(.86); }}
                        to {{ opacity: 1; transform: scale(1); }} }}
@keyframes bn-edge-draw {{ to {{ stroke-dashoffset: 0; }} }}
@keyframes bn-core-in {{ from {{ opacity: 0; }} to {{ opacity: 1; }} }}

/* Tichá verzia MUSÍ byť dosadnutý stav, nie zamrznutý polostav: hrany dokreslené
   (dashoffset 0), uzly a jadro plné. `animation: none` samo by nechalo hranu
   s dashoffset = dĺžka, teda NEVIDITEĽNÚ — sieť by vyzerala ako štyri samostatné
   uzly bez spojení. To je iný znak, nie tichšia verzia toho istého. */
@media (prefers-reduced-motion: reduce) {{
  .bn .bn-node, .bn .bn-edge, .bn .bn-core {{ animation: none; }}
  .bn .bn-edge {{ stroke-dashoffset: 0; }}
  .bn .bn-node, .bn .bn-core {{ opacity: 1; transform: none; }}
}}
```

**Dýchanie jadra (`core-pulse`) sem NEIDE** a nie je to opomenutie: rozhodnutie
z 1. 9. 2026 hovorí, že pulz nesie stav vedomia bdie/spí a patrí **jedinému**
selektoru `#brand-core` v raile (dôvod je zapísaný pri pravidle v `mind.css`).
Sieť v prázdnom stave je ticho pred prácou, nie stav vedomia.
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
# Čo z mini kánonu zostáva a čo sa zmenilo:
#   * ZOSTÁVA vizuálna sémantika plátna: uzol je PRSTENEC (priehľadnosť nesie
#     diera, nie nízka alfa), jadro je jediný sýty PLNÝ prvok a je zlaté;
#     hrany a nesýte uzly sú amethyst (BRAND-HADES §6).
#   * ZMENILA SA povaha identity mini <-> master: do 1. 9. 2026 to boli tie isté
#     ABSOLÚTNE hodnoty (r 36 / 9 / 15 v oboch výkresoch). V sieti to nejde —
#     jadrový uzol s prstencom r 36 nechá v boxe 100 na vedľajšie uzly 5 jednotiek.
#     Identita je preto v POMERE: jadrový uzol si berie mini pomery (0,36 / 0,09
#     / 0,30 boxu) a aplikuje ich na svoj vlastný box NET_CORE_BOX.
#
# Kompozícia je OPTICKÁ, nie mriežková, a je to overiteľná podmienka:
# `assert_optical()` nižšie odmietne rovnostranný trojuholník aj úsečku a odmietne
# bočnú hranu, ktorá by prešla cez jadrový uzol. Bez tej stráže by sa „vyzerá to
# ako výsek siete" dalo pokaziť zmenou jedného čísla a nikto by si to nevšimol.
# Vlastný box jadrového uzla. 38, nie 44, a je to ZAPLATENÉ číslo: pri 44 mal
# jadrový uzol vonkajší okraj 17,82 a hrana k najbližšiemu susedovi vyšla po
# záreze **1,24 jednotky** (zmerané na vydanom SVG) — teda čiarka, nie spojenie.
# Sieť sa nesmie kresliť tak, že jej hrany nie sú vidieť; rozpočet na hranu je
# `vzdialenosť − okraj jadra − okraj suseda − 2 × zárez` a musí zostať kladný
# s rezervou. Kontroluje to `assert_edges_readable()`.
NET_CORE_BOX = 38.0

# Vedľajšie uzly: (uhol v SVG stupňoch, vzdialenosť od stredu, vlastný box).
# Uhly -68° / 195° / 58° dávajú rozstupy 137° / 97° / 126° — teda ani jeden
# rovnostranný trojuholník. Veľkosť KLESÁ so vzdialenosťou (22 → 18 → 15), takže
# vzdialenejší uzol je menší: perspektíva, nie náhoda. Rozloženie po kvadrantoch
# je vážený stred kompozície (49,3 / 47,8) — takmer v strede boxu, čo lockup
# potrebuje, hoci je kresba zámerne nesymetrická.
NET_SATS = (
    (-68.0, 36.0, 22.0),
    (195.0, 39.5, 18.0),
    (58.0, 41.0, 15.0),
)

# Hrany: index 0 je jadro, 1..3 sú NET_SATS v poradí. Tri hrany od jadra a JEDNA
# bočná (1–2) — bez bočnej hrany je to hviezda (rozbočovač), nie sieť. Bočná
# hrana je slabšia: hierarchia „všetko sa viaže na jadro" musí zostať čitateľná.
# Bočná hrana je zámerne najdlhšia: spojenie, ktoré ide okolo jadra, je to, čo
# z výseku robí sieť. Musí ale jadro OBÍSŤ — stráži to `assert_optical()`.
NET_EDGES = ((0, 1, False), (0, 2, False), (0, 3, False), (1, 2, True))
NET_EDGE_W = 1.8
NET_EDGE_GAP = 1.5           # hrana sa nedotýka obruby uzla, končí pred ňou

# Rebrík redukcie: pod týmto počtom px sa NEKRESLÍ sieť, ale mini (jeden uzol).
# Číslo nie je vkusové — pod ním padnú obrysy vedľajších uzlov a hrany pod 1,5 px,
# čo je podlaha kontrastu obrysu v tomto projekte (CLAUDE.md, „Vizuálna sémantika").
# `ladder()` to prepočítava a DERIVED.md to vypisuje ako namerané čísla.
NET_MIN_PX = 128
RING_LW_FLOOR_PX = 1.5

# TRETÍ STUPEŇ, ktorý som pri prvom návrhu rebríka vynechal a musel dopísať:
# podlaha 1,5 px platí na OBRYS. Uzol nakreslený ako PLNÝ DISK obrys nemá, takže
# sieť z diskov drží hlboko pod 128 px — a práve preto ju plocha appky kreslí
# diskami na 24 px. Rebrík má teda tri stupne, nie dva:
#   px >= NET_MIN_PX          -> sieť, uzly PRSTENCE (kánon plátna)
#   NET_DISC_MIN_PX .. 127    -> sieť, uzly PLNÉ DISKY (obrys by nedržal)
#   pod NET_DISC_MIN_PX       -> jeden uzol
# Disky sú ústupok, nie kánon: strácajú „priehľadnosť nesie diera" a na malých
# veľkostiach je to správny ústupok, pretože diera by aj tak zanikla.
NET_DISC_EDGE_W = 3.2        # hrana v diskovom stupni je hrubšia — nesie ju menej px
# 48, nie 32: v diskovom stupni už obrys uzla nerozhoduje (disk ho nemá), ale HRANA
# áno — a tá obrys je. Pri 32 px má hrana 3,2 × 0,32 = 1,02 px, teda pod podlahou;
# pri 48 px 1,54 px, teda nad ňou. Prah teda určuje najtenší prvok, ktorý v stupni
# zostal, nie veľkosť, ktorá sa niekomu zdala rozumná.
NET_DISC_MIN_PX = 48


def _pt(cx: float, cy: float, r: float, deg: float) -> tuple[float, float]:
    a = math.radians(deg)
    return cx + r * math.cos(a), cy + r * math.sin(a)


class Node:
    """Uzol siete v jednotkách boxu mastera.

    `outer` je vonkajší okraj kresby (polomer + polovica obrysu) — hrany sa
    zarezávajú o tento okraj, nie o polomer strednice, inak by hrana vyliezla
    do obruby uzla a spoj by vyzeral zaseknutý.
    """

    def __init__(self, x: float, y: float, r: float, w: float, gold: float = 0.0):
        self.x, self.y, self.r, self.w, self.gold = x, y, r, w, gold

    @property
    def outer(self) -> float:
        return self.r + self.w / 2


def net_geometry(mini: Mini) -> dict[str, object]:
    """JEDEN zdroj geometrie siete pre SVG, PIL raster aj DERIVED.md.

    Tri spotrebitelia jednej kresby by inak boli tri kresby. Presne tak sa raz
    rozišli master a mini a raz lockupy s masterom.
    """
    cx, cy = mini.cx, mini.cy
    core = Node(cx, cy,
                mini.ring_ratio * NET_CORE_BOX,
                mini.stroke_ratio * NET_CORE_BOX,
                gold=mini.core_diameter_ratio / 2 * NET_CORE_BOX)
    nodes = [core]
    for deg, dist, box in NET_SATS:
        x, y = _pt(cx, cy, dist, deg)
        nodes.append(Node(x, y, mini.ring_ratio * box, mini.stroke_ratio * box))

    edges = []
    for a, b, lat in NET_EDGES:
        na, nb = nodes[a], nodes[b]
        dx, dy = nb.x - na.x, nb.y - na.y
        length = math.hypot(dx, dy)
        ux, uy = dx / length, dy / length
        t0 = na.outer + NET_EDGE_GAP
        t1 = length - nb.outer - NET_EDGE_GAP
        edges.append({
            "x1": na.x + ux * t0, "y1": na.y + uy * t0,
            "x2": na.x + ux * t1, "y2": na.y + uy * t1,
            "lat": lat, "len": t1 - t0,
        })
    return {"nodes": nodes, "edges": edges, "box": mini.box}


def assert_optical(geo: dict[str, object]) -> None:
    """Kompozícia musí byť optická, nie mriežková — a musí sa dať zmerať.

    Tri podmienky, každá kalibrovaná tým, že sa dá porušiť jedným číslom
    v NET_SATS:
      1. rozstupy uhlov sa nesmú rovnať (rovnostranný trojuholník),
      2. tri vedľajšie uzly nesmú ležať takmer na priamke (úsečka),
      3. bočná hrana nesmie prejsť cez jadrový uzol.
    """
    nodes = geo["nodes"]
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
    if area < 120.0:
        raise SystemExit(f"siet: vedlajsie uzly lezia takmer na priamke (plocha {area:.1f})")

    for e in geo["edges"]:
        dx, dy = e["x2"] - e["x1"], e["y2"] - e["y1"]
        length = math.hypot(dx, dy)
        ux, uy = dx / length, dy / length
        vx, vy = core.x - e["x1"], core.y - e["y1"]
        t = max(0.0, min(length, vx * ux + vy * uy))
        d = math.hypot(core.x - (e["x1"] + ux * t), core.y - (e["y1"] + uy * t))
        if e["lat"] and d < core.outer + 1.0:
            raise SystemExit(
                f"siet: bocna hrana prechadza cez jadrovy uzol (odstup {d:.2f} "
                f"< {core.outer + 1.0:.2f})")


def assert_edges_readable(geo: dict[str, object], mini: Mini) -> None:
    """Každá hrana musí po záreze zostať SPOJENÍM, nie čiarkou.

    Prah je 6 jednotiek boxu = 7,7 px na 128 px (prvý stupeň, kde sa sieť vôbec
    kreslí). Kalibrácia: pôvodná geometria (NET_CORE_BOX 44, sused vo vzdialenosti
    33) dávala 1,24 jednotky a túto stráž by neprešla — presne ten prípad, ktorý
    som vydal a musel opraviť.
    """
    floor = 6.0
    for i, e in enumerate(geo["edges"], 1):
        if e["len"] < floor:
            raise SystemExit(
                f"siet: hrana {i} ma po zareze len {e['len']:.2f} jednotky "
                f"(prah {floor}) — to nie je spojenie, ale ciarka; "
                "zvac vzdialenost suseda alebo zmensi NET_CORE_BOX")


def ladder(mini: Mini, geo: dict[str, object]) -> list[dict[str, object]]:
    """Stupne redukcie s NAMERANÝMI šírkami v px.

    Nie je to tabuľka podľa vkusu: pre každý stupeň sa spočíta najtenší obrys
    v skutočných pixeloch a porovná s podlahou 1,5 px. Práve to rozhoduje, čo sa
    na danom stupni kreslí — a práve preto je NET_MIN_PX 128 a nie 64.
    """
    rows = []
    for px in (16, 24, 32, 48, 64, 128, 256):
        k = px / mini.box
        ring_thin = min([n.w * k for n in geo["nodes"]] + [NET_EDGE_W * k])
        if px >= NET_MIN_PX:
            row = {"px": px, "stage": "sieť · prstence", "thinnest": ring_thin,
                   "shapes": len(geo["nodes"]) + 1 + len(geo["edges"])}
        elif px >= NET_DISC_MIN_PX:
            row = {"px": px, "stage": "sieť · disky", "thinnest": NET_DISC_EDGE_W * k,
                   "shapes": len(geo["nodes"]) + len(geo["edges"])}
        else:
            row = {"px": px, "stage": "jeden uzol", "thinnest": mini.ring_w * k,
                   "shapes": 2}
        row["ok"] = row["thinnest"] >= RING_LW_FLOOR_PX
        # Kalibrácia OPAČNÝM smerom: koľko by meral najtenší prvok siete
        # v prstencovom stupni, keby sa kreslil aj tu. Bez tejto polovice sa nedá
        # poznať, či je 128 nameraná hranica, alebo len prvá vyskúšaná veľkosť.
        row["ring_thinnest"] = ring_thin
        row["disc_thinnest"] = NET_DISC_EDGE_W * k
        rows.append(row)
    return rows


def build_master(mini: Mini) -> str:
    """Master = výsek siete. Jadrový uzol dedí POMERY mini kánonu."""
    geo = net_geometry(mini)
    assert_optical(geo)
    assert_edges_readable(geo, mini)
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
            f'stroke-width="{num(NET_EDGE_W)}"{cls}/>')

    sat_lines = [
        f'  <circle cx="{num(n.x)}" cy="{num(n.y)}" r="{num(n.r)}" '
        f'stroke-width="{num(n.w)}"/>'
        for n in nodes[1:]
    ]

    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {box} {box}" role="img" aria-label="Hades">',
        "  <title>Hades</title>",
        "  <!-- GENEROVANÉ tools/brand/build-mark.py z hades-sigil-mini.svg — needituj ručne. -->",
        "  <style>",
        f"    svg {{ --acc: {mini.acc_light}; --gold: {mini.gold_light}; }}",
        f"    @media (prefers-color-scheme: dark) {{ svg {{ --acc: {mini.acc_dark}; --gold: {mini.gold_dark}; }} }}",
        "    circle, line { stroke: var(--acc); stroke-linecap: round; fill: none; }",
        "    .edges line { opacity: .8; }",
        "    .edges .lat { opacity: .5; }",
        "    .gold-fill { fill: var(--gold); stroke: none; }",
        "  </style>",
        "  <!-- HRANY sa kreslia PRVÉ, aby uzly stáli na nich, nie naopak. Sú zarezané",
        f"       o vonkajší okraj uzla + {num(NET_EDGE_GAP)}, takže sa obruby nedotýkajú.",
        "       Bočná hrana (.lat) je slabšia — jadro musí zostať tým, na čo sa sieť viaže. -->",
        '  <g class="edges">',
        *edge_lines,
        "  </g>",
        "  <!-- VEDĽAJŠIE UZLY: prstence bez výplne (priehľadnosť nesie diera, nie alfa).",
        "       Tri rôzne veľkosti = hĺbka susedstva. Pod 128 px zmiznú spolu s hranami. -->",
        *sat_lines,
        f"  <!-- JADROVÝ UZOL: pomery mini kánonu ({mini.ring_ratio:.2f} / {mini.stroke_ratio:.2f} /",
        f"       {mini.core_diameter_ratio:.2f} boxu) na vlastnom boxe {num(NET_CORE_BOX)}. Prstenec je AMETHYST,",
        "       stred je jediný sýty PLNÝ prvok celého znaku a je ZLATÝ. -->",
        f'  <circle cx="{num(core.x)}" cy="{num(core.y)}" r="{num(core.r)}" stroke-width="{num(core.w)}"/>',
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
    ink = dark_paper_hex()
    d = derived(mini)

    # Poradie je väzba, nie zvyk: master sa VYDÁ z mini, a mono aj lockupy sa
    # potom čítajú z hotového mastera. Keby sa mono skladalo skôr, nesie o beh
    # starú kresbu — presne tak zostarli lockupy.
    emit(MASTER_SRC, build_master(mini))
    master = read(MASTER_SRC)
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

    print(f"zdroj: {MINI_SRC.relative_to(ROOT).as_posix()} "
          f"(prstenec r{num(mini.ring_r)}/{num(mini.ring_w)}, jadro r{num(mini.core_r)})")
    print(f"dasharray: {d['dasharray']:.2f} · load-mark: box {d['lm_box']} "
          f"border {d['lm_border']} jadro {d['lm_core']}")
    print(f"ico: {ICO_SIZES}")
    for rel in WRITTEN:
        print(("DRY " if DRY else "") + "zapísané: " + rel)
    for rel in UNCHANGED:
        print("bez zmeny: " + rel)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
