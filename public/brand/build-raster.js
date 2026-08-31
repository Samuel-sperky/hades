/*
 * Rastrové derivát y značky: PNG lockupy, OG obrázok a PNG znaku.
 *
 * PREČO DRUHÝ GENERÁTOR VEDĽA build-mark.py: `build-mark.py` rastruje cez PIL,
 * ktoré vie kresliť kruhy — a presne preto zvládne favicon aj .ico, kde je znak
 * len prstenec a jadro. Lockup ale nesie WORDMARK, teda písmo prevedené do
 * kriviek, a tie PIL nakresliť nevie. V prostredí nie je žiadny SVG rasterizér
 * (`cairosvg` chýba, `convert` je Windowsov konvertor diskov, nie ImageMagick),
 * takže rasterizuje Chrome — presne tá cesta, ktorú si projekt zapísal ako
 * funkčnú v CLAUDE.md („Overenie UI").
 *
 * KÁNON JE STÁLE JEDEN: tento skript nič nekreslí, len fotí hotové SVG
 * z public/brand/, ktoré vydal build-mark.py. Poradie je teda povinné:
 *
 *     python public/brand/build-mark.py     # SVG kánon
 *     node   public/brand/build-raster.js   # PNG z neho
 *
 * Pozadie je PRIEHĽADNÉ okrem OG obrázka — ten musí mať papier, pretože ho
 * vykresľujú cudzie platformy na svojom vlastnom podklade.
 */
// ESM, nie CommonJS: package.json projektu má "type": "module", takže .js sa
// načíta ako modul a `require` v ňom neexistuje.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BRAND = path.dirname(fileURLToPath(import.meta.url));
// Tmavý papier appky. Nie je to voľba tohto skriptu — je to tá istá hodnota,
// akú build-mark.py čita z mind.css (--bg-rgb tmavej témy) pre disk faviconu.
const INK = '#0e1413';

/** Čo sa renderuje. `w` je cieľová šírka v px; výška vyjde z pomeru viewBoxu. */
const JOBS = [
  { src: 'hades-lockup-h.svg', out: 'hades-lockup-300.png', w: 300 },
  { src: 'hades-lockup-h.svg', out: 'hades-lockup-600.png', w: 600 },
  { src: 'hades-lockup-h.svg', out: 'hades-lockup-1200.png', w: 1200 },
  { src: 'hades-sigil.svg', out: 'hades-sigil-128.png', w: 128 },
  { src: 'hades-sigil.svg', out: 'hades-sigil-256.png', w: 256 },
  { src: 'hades-sigil.svg', out: 'hades-sigil-512.png', w: 512 },
];
/* OG obrázok je iný prípad: fixné 1200×630, znak s wordmarkom v strede na
   papieri. Cudzia platforma ho kladie na svoje pozadie, takže priehľadnosť by
   dala buď biely, alebo čierny rám podľa toho, kto ho práve zobrazuje. */
const OG = { src: 'hades-lockup-h.svg', out: 'hades-og.png', w: 1200, h: 630, markW: 720 };

function viewBox(svg) {
  const m = svg.match(/viewBox="([\d.\s-]+)"/);
  if (!m) throw new Error('chýba viewBox');
  const [, , w, h] = m[1].trim().split(/\s+/).map(Number);
  return { w, h };
}

/* Znak nesie farby cez `prefers-color-scheme`. Renderujeme TMAVÚ vetvu, lebo
   PNG derivát y sedia na tmavom papieri (OG) alebo v tmavých dokumentoch; pre
   svetlé podklady je tu SVG, ktoré sa prepne samo. */
async function shoot(page, svg, width, height, background) {
  const html = `<!doctype html><html><head><meta name="color-scheme" content="dark"><style>
    html,body{margin:0;padding:0;background:${background || 'transparent'};}
    #wrap{width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center;}
    svg{display:block;}
  </style></head><body><div id="wrap">${svg}</div></body></html>`;
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  return page.screenshot({ omitBackground: !background, type: 'png' });
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--force-color-profile=srgb', '--disable-lcd-text'],
  });
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);

  let changed = 0, same = 0;
  const write = (name, buf) => {
    const p = path.join(BRAND, name);
    const old = fs.existsSync(p) ? fs.readFileSync(p) : null;
    if (old && old.equals(buf)) { same++; console.log('bez zmeny: ' + name); return; }
    fs.writeFileSync(p, buf);
    changed++;
    console.log('zapísané: ' + name + ' (' + buf.length + ' B)');
  };

  for (const job of JOBS) {
    const svg = fs.readFileSync(path.join(BRAND, job.src), 'utf8');
    const vb = viewBox(svg);
    const h = Math.round(job.w * vb.h / vb.w);
    const sized = svg.replace(/<svg /, `<svg width="${job.w}" height="${h}" `);
    write(job.out, await shoot(page, sized, job.w, h, null));
  }

  const ogSvg = fs.readFileSync(path.join(BRAND, OG.src), 'utf8');
  const ovb = viewBox(ogSvg);
  const ogH = Math.round(OG.markW * ovb.h / ovb.w);
  write(OG.out, await shoot(page,
    ogSvg.replace(/<svg /, `<svg width="${OG.markW}" height="${ogH}" `),
    OG.w, OG.h, INK));

  await browser.close();
  console.log('hotovo — zapísané ' + changed + ', bez zmeny ' + same);
})().catch((e) => { console.error('PAD: ' + e.message); process.exit(1); });
