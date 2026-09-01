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
  * public/brand/hades-sigil-mini.svg  — KÁNON: prstenec r36/hrúbka 9, jadro r15
  * public/css/mind.css                — tmavý papier (`--bg-rgb`) pod faviconom

Master (hades-sigil.svg) sa od 28. 8. 2026 GENERUJE z mini a ručným zdrojom už NIE
JE. Dovtedy to boli dva nezávislé výkresy a rozišli sa: master mal nosný prstenec
0,46 boxu, mini 0,36 — znak vedľa znaku teda nesúhlasil. Master pridáva nad mini
len dej (hranica, delenia, prerušenie, hrana, satelit, obežnica) a robí to
z konštánt MASTER_* nižšie.

VÝSTUPY:
  1. public/brand/hades-sigil.svg           (master = mini + dej)
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
     nevlastní (`stroke-dasharray`, tri čísla `.load-mark`, inline blok viewBox 24)

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
    """Znak ako raster. Prstenec sa kreslí ako ANULUS (plný disk r+w/2 a do neho
    atramentový disk r-w/2), nie ako `ellipse(width=)`: PIL kreslí obrys s
    celočíselnou šírkou a na 16 px by 9/100 hrúbky spadlo na 1 px alebo 2 px
    podľa zaokrúhlenia, teda znak by na každej veľkosti vážil inak."""
    n = px * SUPERSAMPLE
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = n / mini.box
    cx, cy = mini.cx * s, mini.cy * s

    def disc(r: float, color: str) -> None:
        d.ellipse([cx - r * s, cy - r * s, cx + r * s, cy + r * s], fill=color)

    disc(mini.disk_r, ink)
    disc(mini.ring_r + mini.ring_w / 2, mini.acc_dark)
    disc(mini.ring_r - mini.ring_w / 2, ink)
    disc(mini.core_r, mini.gold_dark)
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
                  "           Needituj ručne. Znak tu nesie rolu „desktop okno\" (identita appky v ráme,\n"
                  "           ktorý nie je prehliadač), preto sa NEANIMUJE — pulz behu patrí #brand-core. -->"
                  + topbar)

    off = ROOT / "electron" / "states" / "offline.html"
    markup = (
        "\n"
        f'        <svg class="sigil" viewBox="0 0 {num(mini.box)} {num(mini.box)}" aria-hidden="true">\n'
        f'            <circle class="ring" cx="{c}" cy="{c}" r="{num(mini.ring_r)}"></circle>\n'
        f'            <circle class="core" cx="{c}" cy="{c}" r="{num(mini.core_r)}"></circle>\n'
        "        </svg>\n        "
    )
    patch_between(off, "<!-- ZNAK: generuje", "<!-- /ZNAK -->",
                  " tools/brand/build-mark.py — needituj ručne -->" + markup)

    style = (
        "\n"
        f"        .sigil .ring {{ fill: none; stroke: var(--accent); "
        f"stroke-width: {num(mini.ring_w)}; }}\n"
        f"        .sigil .core {{ fill: var(--gold); "
        f"transform-origin: {num(mini.cx)}px {num(mini.cy)}px; }}\n        "
    )
    patch_between(off, "/* ZNAK-STYLE: generuje", "/* /ZNAK-STYLE */",
                  " tools/brand/build-mark.py zo hades-sigil-mini.svg.\n"
                  "           Needituj ručne — pri najbližšom behu generátora sa zmena stratí.\n"
                  "           Dôvod, prečo je geometria aj tu: tento dokument sa zobrazuje, KEĎ SERVER\n"
                  "           NEBEŽÍ, takže nemôže načítať mind.css ani nič z public/. */"
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

## Pre Blade markup (vlastní F1 pre `mind`, F2 pre `chat`)

Na **jadre** je `fill="var(--brand-gold)"` kánon; `currentColor` sa opúšťa — sú to
dva mechanizmy a jeden zanikne pri prvej zmene farby (`mind.blade.php:131` ho ešte
má). **Prstenec** zostáva `var(--accent)`: amethyst je interaktívny nosič, zlatá je
vyhradená jadru. Triedy `bc-ring` / `bc-core` sú povinné, bez nich sa znak nikdy
nezrodí — animáciu na ne vešia `mind.css` (`chat.blade.php:86` a `:182` ich nemajú).

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
    emit(TOOLS / "DERIVED.md", md)


# --------------------------------------------------------------------------- #

# --------------------------------------------------------------------------- #
# 6b. MASTER — obohatenie mini kánonu
# --------------------------------------------------------------------------- #
#
# Master sa GENERUJE z mini, nie kreslí ručne. To je celý zmysel variantu
# „Jedno oko" (kontrakt 28. 8. 2026, A1): nosný prstenec a jadro sú v oboch
# výkresoch tie isté hodnoty, takže znak v 16 px a znak v 512 px je ten istý
# objekt. Do 28. 8. 2026 boli master a mini dva nezávislé súbory a rozišli sa —
# master mal prstenec 0,46 boxu, mini 0,36.
#
# Tieto konštanty sú JEDINÉ, čo master pridáva nad mini. Menia sa tu a nikde inde.
MASTER_GAP_DEG = 34.0        # šírka prerušenia nosného prstenca
MASTER_GAP_AT = -38.0        # stred prerušenia v SVG stupňoch = 52° od vertikály
MASTER_HAIR_R = 47.0         # vlásková hranica vedomia (neprerušená)
MASTER_HAIR_W = 1.0
MASTER_TICKS = 12            # delenia po 30°; v prerušení mlčia
MASTER_TICK_R1 = 43.0
MASTER_SAT_R = 5.5           # satelit: jeden uzol, prstenec nie disk
MASTER_SAT_W = 2.5
MASTER_ORBIT_R = 22.0        # obežnica jadra (zlatá)
MASTER_EDGE_R1 = 30.0        # hrana: od satelitu k jadru
MASTER_EDGE_R2 = 18.0
MASTER_EDGE_W = 1.6


def _pt(cx: float, cy: float, r: float, deg: float) -> tuple[float, float]:
    a = math.radians(deg)
    return cx + r * math.cos(a), cy + r * math.sin(a)


def build_master(mini: Mini) -> str:
    """Master = mini (prstenec + jadro) + dej okolo neho."""
    cx, cy = mini.cx, mini.cy
    g0 = MASTER_GAP_AT + MASTER_GAP_DEG / 2
    g1 = MASTER_GAP_AT - MASTER_GAP_DEG / 2
    ax, ay = _pt(cx, cy, mini.ring_r, g0)
    bx, by = _pt(cx, cy, mini.ring_r, g1)
    span = (g1 - g0) % 360
    large = 1 if span > 180 else 0

    ticks = []
    for i in range(MASTER_TICKS):
        ang = -90.0 + i * (360.0 / MASTER_TICKS)
        # mlčí v prerušení — porovnáva sa uhol RELATÍVNE k začiatku medzery
        if (ang - (MASTER_GAP_AT - MASTER_GAP_DEG / 2)) % 360 < MASTER_GAP_DEG:
            continue
        x1, y1 = _pt(cx, cy, MASTER_TICK_R1, ang)
        x2, y2 = _pt(cx, cy, MASTER_HAIR_R, ang)
        ticks.append(f'    <line x1="{num(x1)}" y1="{num(y1)}" '
                     f'x2="{num(x2)}" y2="{num(y2)}" stroke-width="1"/>')

    sx, sy = _pt(cx, cy, mini.ring_r, MASTER_GAP_AT)
    e1x, e1y = _pt(cx, cy, MASTER_EDGE_R1, MASTER_GAP_AT)
    e2x, e2y = _pt(cx, cy, MASTER_EDGE_R2, MASTER_GAP_AT)
    nl = newline_of(read(MINI_SRC))
    box = num(mini.box)

    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {box} {box}" role="img" aria-label="Hades">',
        "  <title>Hades</title>",
        "  <!-- GENEROVANÉ tools/brand/build-mark.py z hades-sigil-mini.svg — needituj ručne. -->",
        "  <style>",
        f"    svg {{ --acc: {mini.acc_light}; --gold: {mini.gold_light}; }}",
        f"    @media (prefers-color-scheme: dark) {{ svg {{ --acc: {mini.acc_dark}; --gold: {mini.gold_dark}; }} }}",
        "    path, circle, line { stroke: var(--acc); stroke-linecap: round; fill: none; }",
        "    .gold-stroke { stroke: var(--gold); }",
        "    .gold-fill { fill: var(--gold); stroke: none; }",
        "    .ticks line { opacity: .45; }",
        "    .edge { opacity: .75; }",
        "  </style>",
        f"  <!-- vlásková hranica vedomia (r {num(MASTER_HAIR_R)}): neprerušená, len rám deja -->",
        f'  <circle cx="{num(cx)}" cy="{num(cy)}" r="{num(MASTER_HAIR_R)}" '
        f'stroke-width="{num(MASTER_HAIR_W)}" opacity=".55"/>',
        f"  <!-- {MASTER_TICKS} delení po {num(360 / MASTER_TICKS)}°, mlčia v prerušení -->",
        '  <g class="ticks">',
        *ticks,
        "  </g>",
        f"  <!-- NOSNÝ PRSTENEC (r {num(mini.ring_r)}, hrúbka {num(mini.ring_w)}) — TOTOŽNÝ s mini",
        f"       kánonom. Prerušený {num(MASTER_GAP_DEG)}° tam, kde vstupuje uzol. Pod 64 px sa",
        "       prerušenie zatvára a kreslí sa mini: ten istý prstenec, to isté jadro. -->",
        f'  <path d="M {num(ax)} {num(ay)} A {num(mini.ring_r)} {num(mini.ring_r)} 0 {large} 1 '
        f'{num(bx)} {num(by)}" stroke-width="{num(mini.ring_w)}"/>',
        "  <!-- hrana: uzol viazaný na jadro -->",
        f'  <line x1="{num(e1x)}" y1="{num(e1y)}" x2="{num(e2x)}" y2="{num(e2y)}" '
        f'stroke-width="{num(MASTER_EDGE_W)}" class="edge"/>',
        "  <!-- satelit: jeden uzol, prstenec (nie disk), v prerušení NA prstenci -->",
        f'  <circle cx="{num(sx)}" cy="{num(sy)}" r="{num(MASTER_SAT_R)}" '
        f'stroke-width="{num(MASTER_SAT_W)}"/>',
        f"  <!-- jadro: obežnica + jediný sýty PLNÝ prvok znaku. r {num(mini.core_r)} = mini kánon. -->",
        f'  <circle cx="{num(cx)}" cy="{num(cy)}" r="{num(MASTER_ORBIT_R)}" stroke-width="1" class="gold-stroke"/>',
        f'  <circle cx="{num(cx)}" cy="{num(cy)}" r="{num(mini.core_r)}" class="gold-fill"/>',
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
