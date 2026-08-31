#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Zástupca: geometria znaku tu už NEŽIJE.

Do 27. 8. 2026 bol tento súbor druhou implementáciou znaku — hardcoded RGB tuply
a prstenec ako anulus r40,5 − r31,5. Bol to zápis #14 zo šestnástich a jediný
generátor akejkoľvek `.ico` v repe, pričom `public/favicon.ico` zdroj nemal vôbec.
Teraz obe `.ico` vydáva jeden generátor, ktorý číta `public/brand/hades-sigil-mini.svg`:

    python tools/brand/build-mark.py

Súbor tu zostáva preto, že `electron-builder.yml` a README naň odkazovali a beh
`python electron/assets/build-icon.py` je zabehnutý zvyk — má teda robiť správnu
vec, nie mlčať. Overené: výstup nového generátora je pre `electron/assets/hades.ico`
bajt na bajt ten istý ako výstup starej verzie tohto skriptu.
"""
import runpy
import sys
from pathlib import Path

GENERATOR = Path(__file__).resolve().parents[2] / "public" / "brand" / "build-mark.py"

if __name__ == "__main__":
    print(f"znak sa generuje z jedného zdroja: {GENERATOR.name}", file=sys.stderr)
    runpy.run_path(str(GENERATOR), run_name="__main__")
