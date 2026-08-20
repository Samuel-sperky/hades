# -*- coding: utf-8 -*-
"""Stavia wordmark a lockupy Hadesa. Písmo sa prevádza DO KRIVIEK, takže hotové
assety nezávisia od žiadneho fontu a v appke nepribúda runtime závislosť."""
import io, re
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

TRACK = 0.06          # rozstup nápisových kapitálok
FONT  = 'Cinzel-600.ttf'

def glyph_paths(word, tracking=TRACK, font=FONT):
    f=TTFont(font); gs=f.getGlyphSet(); cmap=f.getBestCmap(); hmtx=f['hmtx']
    upem=f['head'].unitsPerEm; x=0; out=[]
    bp=BoundsPen(gs); bx=0
    for ch in word:
        gn=cmap[ord(ch)]
        pen=SVGPathPen(gs); gs[gn].draw(TransformPen(pen,(1,0,0,-1,x,0)))
        d=pen.getCommands()
        if d: out.append(d)
        gs[gn].draw(TransformPen(bp,(1,0,0,-1,bx,0)))
        adv=hmtx[gn][0]+tracking*upem; x+=adv; bx+=adv
    return out, bp.bounds

WM, WMB = glyph_paths('Hades')
x0,y0,x1,y1 = WMB                     # y0 = -cap (hore), y1 ≈ 0 (baseline)
WM_W, WM_H = x1-x0, y1-y0
def wm_group(scale, tx, ty, fill='currentColor'):
    """Wordmark posunutý tak, aby jeho ľavý horný roh sedel na (tx,ty)."""
    s=scale
    return (f'<g transform="translate({tx:.2f} {ty:.2f}) scale({s:.5f}) translate({-x0:.2f} {-y0:.2f})" fill="{fill}" stroke="none">'
            + ''.join(f'<path d="{d}"/>' for d in WM) + '</g>')

# ---- samotný wordmark ------------------------------------------------------
pad = WM_H*0.12
io.open('hades-wordmark.svg','w',encoding='utf-8').write(
f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WM_W+2*pad:.0f} {WM_H+2*pad:.0f}" role="img" aria-label="Hades">
  <title>Hades</title>
  <!-- Cinzel 600, rozstup {TRACK}em, prevedené do kriviek. Nemeniť rozstup:
       nápisové kapitálky bez neho zlepia D a E. -->
  {wm_group(1, pad, pad)}
</svg>
''')

ROOT_STYLE = """  <style>
    /* Wordmark je ATRAMENTOVÝ, farbu nesie znak. Zlatá zostáva jadru. */
    svg { --acc: #6d3fb5; --gold: #b88a3a; --ink: #101d1b; }
    @media (prefers-color-scheme: dark) { svg { --acc: #c4a2f5; --gold: #d8b878; --ink: #eaf3f1; } }
  </style>
"""

SIGIL = re.sub(r'<\?xml[^>]*\?>','', io.open('hades-sigil.svg',encoding='utf-8').read()).strip()
def sigil_group(size, tx, ty):
    # Pravidlá znaku sa ZAPUZDRIA pod .sig — inak `path { fill: none; stroke }`
    # uteče na písmo lockupu a wordmark sa vykreslí obtiahnutý namiesto vyplneného.
    inner = re.sub(r'^<svg[^>]*>|</svg>$', '', SIGIL, flags=re.S)
    inner = re.sub(r'<title>.*?</title>', '', inner, flags=re.S)

    def scope(m):
        css = m.group(1); out = []
        for chunk in re.findall(r'@media[^{]*\{.*?\}\s*\}|[^{}]+\{[^{}]*\}', css, flags=re.S):
            if chunk.strip().startswith('@media'):
                head, inner_css = chunk.split('{', 1)
                inner_css = inner_css.rsplit('}', 1)[0]
                out.append(head + '{' + scope_rules(inner_css) + '}')
            else:
                out.append(scope_rules(chunk))
        return '<style>' + ''.join(out) + '</style>'

    def scope_rules(css):
        out = []
        for rule in re.findall(r'[^{}]+\{[^{}]*\}', css, flags=re.S):
            sel, body = rule.split('{', 1)
            sels = ', '.join(('.sig' if p.strip() == 'svg' else '.sig ' + p.strip())
                             for p in sel.split(',') if p.strip())
            out.append(sels + '{' + body)
        return ''.join(out)

    inner = re.sub(r'<style>(.*?)</style>', scope, inner, flags=re.S)
    return f'<g class="sig" transform="translate({tx:.2f} {ty:.2f}) scale({size/100:.5f})">{inner}</g>'

# ---- horizontálny lockup: znak + wordmark ----------------------------------
# Pravidlo: výška znaku = 1,55 × výška verzálky; medzera = 0,34 × výška znaku.
MARK = 100.0
CAP  = MARK/1.55
GAP  = MARK*0.34
s    = CAP/WM_H
wmw  = WM_W*s
W,H  = MARK+GAP+wmw, MARK
io.open('hades-lockup-h.svg','w',encoding='utf-8').write(
f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H:.0f}" role="img" aria-label="Hades">
  <title>Hades</title>
  <!-- výška znaku : výška verzálky = 1,55 : 1 · medzera = 0,34 × výška znaku
       wordmark je opticky centrovaný na stred znaku -->
{ROOT_STYLE}  {sigil_group(MARK, 0, 0)}
  {wm_group(s, MARK+GAP, (MARK-CAP)/2, 'var(--ink)')}
</svg>
''')

# ---- vertikálny lockup -----------------------------------------------------
VGAP = MARK*0.22
vw   = max(MARK, wmw)
io.open('hades-lockup-v.svg','w',encoding='utf-8').write(
f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vw:.0f} {MARK+VGAP+CAP:.0f}" role="img" aria-label="Hades">
  <title>Hades</title>
{ROOT_STYLE}  {sigil_group(MARK, (vw-MARK)/2, 0)}
  {wm_group(s, (vw-wmw)/2, MARK+VGAP, 'var(--ink)')}
</svg>
''')
print(f'wordmark {WM_W:.0f}×{WM_H:.0f}  ·  lockup-h {W:.0f}×{H:.0f}  ·  lockup-v {vw:.0f}×{MARK+VGAP+CAP:.0f}')
