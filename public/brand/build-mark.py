#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Jeden generátor znaku Hades — jeden zdroj geometrie, sedem výstupov.

    python public/brand/build-mark.py            # prepíše výstupy
    python public/brand/build-mark.py --dry-run  # len vypíše odvodené hodnoty

PREČO to existuje: geometria znaku bola 27. 8. 2026 zapísaná 16× v repe a dvakrát
ako binárka bez zdroja (`public/favicon.ico`, `electron/assets/hades.ico`). Každý
taký zápis je miesto, kde znak môže tichom driftnúť — a `.load-mark` v mind.css už
driftol (prstenec 0,46 boxu proti kánonickým 0,36). Generátor to nezlieva do
jedného tvaru; zlieva to do jedného ZDROJA a rozdiely medzi výskytmi robí
vypočítanými, nie ručnými.

ZDROJE (jediné miesta, kde sa geometria a farby znaku píšu rukou):
  * public/brand/hades-sigil-mini.svg  — kánon mini: prstenec r36/hrúbka 9, jadro r15
  * public/brand/hades-sigil.svg       — kánon master: A46 / B34 / C22 / satelit / jadro
  * public/css/mind.css                — tmavý papier (`--bg-rgb`) pod faviconom

VÝSTUPY:
  1. public/brand/hades-sigil-mono.svg      (master jednofarebne)
  2. public/brand/hades-favicon.svg         (mini na atramentovom disku — zdroj data-URI)
  3. public/brand/apple-touch-icon.png      (180 px, tá istá kompozícia)
  4. public/favicon.ico + electron/assets/hades.ico  (16/24/32/48/64/128/256)
  5. <link rel="icon"> data-URI v troch blade súboroch (bit-identický vo všetkých)
  6. znak v electron/chrome/topbar.html a electron/states/offline.html (medzi ZNAK markermi)
  7. public/brand/DERIVED.md — odvodené čísla pre CSS a Blade, ktoré tento generátor
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
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
BRAND = ROOT / "public" / "brand"

MINI_SRC = BRAND / "hades-sigil-mini.svg"
MASTER_SRC = BRAND / "hades-sigil.svg"
MIND_CSS = ROOT / "public" / "css" / "mind.css"

BLADES = [
    ROOT / "resources" / "views" / "mind.blade.php",
    ROOT / "resources" / "views" / "console.blade.php",
    ROOT / "resources" / "views" / "chat.blade.php",
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
        "  <!-- GENEROVANÉ public/brand/build-mark.py — needituj ručne.\n"
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


def patch_blade_icons(uri: str) -> None:
    """Prepíše LEN riadok <link rel="icon"> v troch blade súboroch.

    Vlastníctvo v tomto behu je po súboroch a v blade po regiónoch: tento
    generátor smie do blade zapísať jediný riadok. Preto regex, nie šablóna —
    šablóna by prepísala celý <head>.
    """
    for blade in BLADES:
        src = read(blade)
        # Bez koncovej zátvory `$`: v CRLF súbore je pred koncom riadka `\r`
        # a anker by nesedel — regex by nenašiel nič a generátor by padol.
        pat = re.compile(r'(?m)^(\s*<link rel="icon" href=")([^"]*)(">)')
        if not pat.search(src):
            raise SystemExit(f"{blade.name}: nenašiel som riadok <link rel=\"icon\">")
        emit(blade, pat.sub(lambda m: m.group(1) + uri + m.group(3), src, count=1))


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
                  " public/brand/build-mark.py zo hades-sigil-mini.svg.\n"
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
                  " public/brand/build-mark.py — needituj ručne -->" + markup)

    style = (
        "\n"
        f"        .sigil .ring {{ fill: none; stroke: var(--accent); "
        f"stroke-width: {num(mini.ring_w)}; }}\n"
        f"        .sigil .core {{ fill: var(--gold); "
        f"transform-origin: {num(mini.cx)}px {num(mini.cy)}px; }}\n        "
    )
    patch_between(off, "/* ZNAK-STYLE: generuje", "/* /ZNAK-STYLE */",
                  " public/brand/build-mark.py zo hades-sigil-mini.svg.\n"
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
    md = f"""<!-- GENEROVANÉ public/brand/build-mark.py — needituj ručne. -->
# Odvodené hodnoty znaku

Tento súbor je výstup `public/brand/build-mark.py`. Nesie čísla pre miesta, ktoré
generátor **nevlastní** (CSS a Blade markup), aby ich nikto nepočítal rukou. Keď sa
zmení `hades-sigil-mini.svg`, spusti generátor a prepíš podľa tejto tabuľky.

Regenerácia:

```
python public/brand/build-mark.py
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
   z public/brand/build-mark.py, nie ručná konštanta. Keď sa zmení zdroj znaku,
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

## data-URI faviconu (v `<head>` troch blade súborov, spravuje generátor)

```
{uri}
```
"""
    emit(BRAND / "DERIVED.md", md)


# --------------------------------------------------------------------------- #

def main() -> int:
    mini = Mini(read(MINI_SRC))
    ink = dark_paper_hex()
    d = derived(mini)

    emit(BRAND / "hades-sigil-mono.svg", build_mono(read(MASTER_SRC)))
    emit(BRAND / "hades-favicon.svg", favicon_svg(mini, ink))
    uri = favicon_data_uri(mini, ink)
    patch_blade_icons(uri)
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
