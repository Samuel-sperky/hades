// -----------------------------------------------------------------------------
// Výpis frontu odložených zápisov (`hades pending`). Tento modul vie o obrazovke
// a nič o HTTP — rovnaké rozdelenie ako `render.mjs`.
//
// Prečo vlastný modul a nie ďalšia metóda v `createRenderer()`: front nie je
// súčasťou ťahu. Renderer drží stav rozpísanej odpovede (`midLine`, mená toolov
// podľa id) a nič z toho tu neplatí — `pending` je jednorazový výpis, ktorý sa
// dá celý zložiť do stringu a otestovať bez streamu.
//
// Farby sa NEZAVÁDZAJÚ znova. Paleta žije v `render.mjs`; odtiaľ sa berie
// `colorizeDiff()`, pretože diff je jediné, čo tu farbu naozaj potrebuje —
// v náhľade zápisu je rozdiel medzi `+` a `-` to, o čom sa človek rozhoduje.
// Druhá kópia ANSI kódov by sa raz rozišla s prvou.
// -----------------------------------------------------------------------------

import { clip, colorizeDiff, relativeTime, summarizeArgs } from './render.mjs';

/**
 * Koľko riadkov náhľadu ukázať pri jednom návrhu.
 *
 * Viac než v karte toolu (12) a menej než pri potvrdzovaní v behu (40): vo fronte
 * môže byť päť návrhov naraz a celé diffy by vytlačili zo obrazovky ten prvý,
 * ale výpis bez diffu je zoznam, podľa ktorého sa rozhodnúť nedá.
 */
const PREVIEW_LINES = 16;
const PREVIEW_CHARS = 2000;

/**
 * Celý výpis frontu ako jeden string.
 *
 * @param {{proposals?: unknown, total?: unknown}} payload odpoveď `/api/console/cli/pending`
 * @param {{color?: boolean}} [options]
 */
export function formatProposals(payload, { color = false } = {}) {
  const list = Array.isArray(payload?.proposals) ? payload.proposals : [];
  const total = Number.isFinite(Number(payload?.total)) ? Number(payload.total) : list.length;

  if (list.length === 0) {
    // Prázdny front je bežný stav, nie chyba — a treba pri ňom povedať, odkiaľ
    // by sa tam návrhy vzali. Inak to vyzerá ako pokazený príkaz.
    return 'Front je prázdny — žiadny odložený zápis nečaká.\n'
      + 'Návrhy do neho pridáva beh bez človeka (nočný rozvrh, `run --json`, MCP): zápis sa tam\n'
      + 'nevykoná ani nezaparkuje vlákno, len sa zaznamená.';
  }

  const lines = [head(list.length, total)];

  for (const [index, proposal] of list.entries()) {
    lines.push('', ...one(proposal, index + 1, color));
  }

  lines.push('', 'Rozhodnutie:  hades pending approve <id>  ·  hades pending deny <id>');

  return lines.join('\n');
}

/**
 * Potvrdenie rozhodnutia.
 *
 * Vypisuje sa to, čo vrátil SERVER, nie to, o čo klient žiadal. Pri druhom
 * `approve` na ten istý návrh server tool znova nevykoná (front je idempotentný)
 * a stav v odpovedi je jediné, z čoho sa to dá zistiť — keby klient hlásil
 * „povolené" podľa svojho príkazu, tvrdil by, že sa práve stalo niečo, čo sa
 * stalo pred hodinou.
 *
 * @param {Record<string, unknown>} payload
 * @param {'approve'|'deny'} decision
 */
export function formatDecision(payload, decision) {
  const proposal = record(payload?.proposal) ?? record(payload) ?? {};
  const name = String(proposal.name ?? '?');
  const status = String(proposal.status ?? '?');

  const head = status === 'approved'
    ? `Povolené · ${name}`
    : status === 'denied'
      ? `Zamietnuté · ${name}`
      : `Server hlási stav „${status}" · ${name}`;

  const lines = [`${head}  ${summarizeArgs(name, proposal.arguments)}`.trimEnd()];

  const result = typeof proposal.result === 'string' ? proposal.result.trim() : '';
  if (result !== '') lines.push(indent(clip(result, 12, 1400), '  '));

  // Rozhodnutie, ktoré neprešlo, sa NESMIE prečítať ako úspech: `approve` na už
  // rozhodnutý návrh vráti pôvodný stav a tool sa druhýkrát nevykoná.
  if (decision === 'approve' && status === 'denied') {
    lines.push('  Pozor: tento návrh bol už predtým zamietnutý — nič sa nevykonalo.');
  }

  return lines.join('\n');
}

function head(shown, total) {
  const suffix = total > shown ? ` (zobrazujem ${shown})` : '';

  return `Front odložených zápisov · ${total} ${plural(total)}${suffix}`;
}

/** @returns {string[]} */
function one(proposal, order, color) {
  const p = record(proposal) ?? {};
  const name = String(p.name ?? '?');
  const args = summarizeArgs(name, p.arguments);

  const lines = [`${order}. ${name}${args === '' ? '' : '  ' + args}`];
  lines.push(`   id ${String(p.id ?? '?')}  ·  ${relativeTime(p.created_at)}`
    + (p.thread ? `  ·  vlákno ${String(p.thread)}` : ''));

  const preview = typeof p.preview === 'string' ? p.preview : '';

  if (preview.trim() !== '') {
    lines.push(colorizeDiff(clip(preview, PREVIEW_LINES, PREVIEW_CHARS), color, '   '));
  }

  // Server strihá náhľad tiež a priznáva to; klient to musí zopakovať, inak
  // človek povolí zápis, ktorého druhú polovicu nevidel.
  if (p.preview_truncated) {
    lines.push('   … náhľad je odseknutý aj na serveri — celý diff je v návrhu.');
  }

  return lines;
}

/** Slovenský plurál pre „čaká": 1 čaká, 2–4 čakajú, 5+ čaká. */
function plural(count) {
  return count >= 2 && count <= 4 ? 'čakajú' : 'čaká';
}

function indent(text, pad) {
  return text.split('\n').map((line) => pad + line).join('\n');
}

/** @returns {Record<string, unknown>|null} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : null;
}
