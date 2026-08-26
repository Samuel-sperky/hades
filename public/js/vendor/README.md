# public/js/vendor — self-hostované knižnice tretích strán

Dva skripty, ktoré plocha Grafu potrebuje ako globály (`window.d3`,
`window.Pusher`). Do 26. 8. 2026 sa ťahali z `cdn.jsdelivr.net` **bez
`integrity`**, takže CSP povolila *hosta, nie obsah* — kompromitovaný jsdelivr by
na verejne tunelovanej appke prešiel. Sú tu z toho istého dôvodu, z akého sú
self-hostované fonty v `public/fonts/`: appka nemá závisieť na cudzom hoste.

Súbory sú **bajt na bajt zhodné s upstreamom**, vrátane `sourceMappingURL`
riadka v `pusher.min.js` (preto je tu aj `.map` a `.LICENSE.txt`, na ktoré ten
súbor odkazuje). Nič sa v nich neupravovalo — inak by hash nižšie prestal byť
overiteľný proti balíku na npm.

| Súbor | Verzia | sha256 | Bajtov |
|---|---|---|---|
| `d3.min.js` | d3 **7.9.0** (ISC) | `f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539` | 279 706 |
| `pusher.min.js` | pusher-js **8.6.0** (MIT) | `91640c608080a550d7a7407f943fa8429e9f6d7d567d0bb810f5f6e73b06972a` | 60 621 |
| `pusher.min.js.map` | pusher-js 8.6.0 | `61350243aa7a64e5b4623b59511a1cf600b1dea77ac5a5aeb70814f9d7a2fb3b` | 275 732 |
| `pusher.min.js.LICENSE.txt` | pusher-js 8.6.0 | `1e0f11e87dbb0f2982cf1912a1b6f6da44d04da3e45c870c8fea7dbc7f48151c` | 131 |

Verzie boli pri stiahnutí (26. 8. 2026) tie, na ktoré `@7` a `@8` v starých CDN
URL rozlišovali — overené cez `data.jsdelivr.com/v1/packages/npm/<pkg>/resolved`.

## Ako overiť, že tu leží to, čo tvrdí tabuľka

Hashe **nie sú odniekad prepísané** — boli spočítané zo stiahnutého obsahu
a skontrolované proti **druhému, nezávislému mirroru** npm (unpkg): oba súbory
prišli z jsdelivr aj z unpkg bajt na bajt zhodné (`cmp` bez rozdielu). Zopakovať
sa to dá takto:

```sh
curl -sSL -o /tmp/d3.js     https://unpkg.com/d3@7.9.0/dist/d3.min.js
curl -sSL -o /tmp/pusher.js https://unpkg.com/pusher-js@8.6.0/dist/web/pusher.min.js
cmp /tmp/d3.js     public/js/vendor/d3.min.js
cmp /tmp/pusher.js public/js/vendor/pusher.min.js
```

## Čo sa stane pri aktualizácii

1. Stiahni novú verziu, over ju z dvoch mirrorov a **prepíš tabuľku vyššie**
   (verzia, hash, veľkosť). Tabuľka, ktorá zaostane, je horšia než žiadna.
2. Mená globálov sa nesmú zmeniť. `public/js/mind/sim.js` číta `window.d3`
   (s vlastnou strážou `d3ok()`), `public/js/mind/ws.js` volá `new Pusher(...)`
   bez stráže. Oba súbory sú UMD, takže bez modulového prostredia si globál
   nastavia samé — self-hosting je tým drop-in.
3. Poradie v `resources/views/mind.blade.php` drž: oba `<script>` musia stáť
   **pred** `/js/mind/main.js`, inak `sim.js` d3 nenájde a graf sa usadí bez
   relaxácie.
4. Politika v `app/Http/Middleware/ContentSecurityPolicy.php` je odteraz
   `script-src 'self'` na **všetkých** plochách. Nový CDN skript ju rozbije — a to
   je zámer, nie prekážka.
