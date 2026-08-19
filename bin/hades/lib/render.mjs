// -----------------------------------------------------------------------------
// Vykresľovanie. Tento modul vie o obrazovke a nič o HTTP.
//
// Dve veci, ktoré tu nie sú kozmetika:
//
//  • Text odpovede ide na `out`, všetko ostatné (karty toolov, stavy, čísla) na
//    `err`. Vďaka tomu `hades run "…" > odpoved.txt` uloží odpoveď a nie aj
//    kresbu. V interaktívnom režime je `err` ten istý stream ako `out` —
//    zámerne, pretože zápis na TTY je na Windows asynchrónny a dva rôzne streamy
//    na tú istú konzolu by si vedeli riadky poprehadzovať.
//
//  • Farby sa vypnú, keď to nie je terminál alebo je nastavené NO_COLOR. Escape
//    sekvencie v prerúrovanom výstupe sú odpad, ktorý sa ťažko griepuje.
// -----------------------------------------------------------------------------

const A = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  bold: '\u001b[1m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
};

/** Dlhý výsledok toolu sa strihá — a klient to MUSÍ priznať, inak lže o tom, čo tool vrátil. */
const RESULT_LINES = 12;
const RESULT_CHARS = 1400;
/** Náhľad zápisu (diff) znesie viac: je to to, o čom sa človek rozhoduje. */
const PREVIEW_LINES = 40;

export function detectColor({ stream = process.stdout, env = process.env } = {}) {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '') return true;

  return Boolean(stream && stream.isTTY);
}

/**
 * @param {{out?: NodeJS.WriteStream, err?: NodeJS.WriteStream, color?: boolean}} [options]
 */
export function createRenderer({ out = process.stdout, err = out, color } = {}) {
  const useColor = color === undefined ? detectColor({ stream: out }) : color;

  /** Meno toolu podľa `id` — rámec `tool_result` meno nenesie, len `id`. */
  const toolNames = new Map();
  /** Skončil posledný zápis textu odpovede uprostred riadku? */
  let midLine = false;

  const c = (code, text) => (useColor ? code + text + A.reset : text);
  const dim = (text) => c(A.dim, text);

  function write(text) {
    if (text === '') return;
    out.write(text);
    midLine = !text.endsWith('\n');
  }

  /** Karta toolu sa nesmie prilepiť na rozpísanú vetu modelu. */
  function breakText() {
    if (midLine) {
      out.write('\n');
      midLine = false;
    }
  }

  function note(text) {
    breakText();
    err.write(text + '\n');
  }

  function frame(f) {
    switch (f.t) {
      case 'start':
        note(dim(`· ${f.model ?? '?'} (${f.provider ?? '?'})`));
        break;

      case 'step':
        // Krok kreslíme len ako tichú stopu; pri 12 krokoch by hlasná hlavička
        // prekryla odpoveď, ktorá je to podstatné.
        if (Number(f.n) > 1) note(dim(`· krok ${f.n}/${f.of}`));
        break;

      case 'delta':
        if (typeof f.text === 'string') write(f.text);
        break;

      case 'tool':
        toolNames.set(f.id, f.name);
        breakText();
        err.write(`${c(A.cyan, '┌ ' + String(f.name))}${f.write ? c(A.yellow, ' (zápis)') : ''}  ${dim(summarizeArgs(f.name, f.arguments))}\n`);
        break;

      case 'tool_result': {
        const label = {
          done: c(A.green, 'hotovo'),
          failed: c(A.red, 'zlyhalo'),
          denied: c(A.yellow, 'zamietnuté'),
        }[String(f.status)] ?? String(f.status);

        const name = toolNames.get(f.id);
        const ms = Number(f.duration_ms ?? 0);
        err.write(`${c(A.cyan, '└')} ${label}${name ? dim(' · ' + name) : ''} ${dim('· ' + duration(ms))}\n`);

        const body = typeof f.result === 'string' ? f.result : '';
        if (body.trim() !== '') err.write(indent(clip(body, RESULT_LINES, RESULT_CHARS), '  ') + '\n');
        break;
      }

      case 'error':
        note(c(A.red, '✗ ' + String(f.message ?? 'Beh spadol.')));
        break;

      case 'end':
        // `end` vypisuje `turnResult()` — až po ňom je jasné, či ťah dobehol.
        break;

      default:
        // Neznámy typ rámca sa ignoruje. Protokol sa rozširuje aditívne a starší
        // klient nesmie na novom rámci ani spadnúť, ani kričať.
        break;
    }
  }

  /** Otázka na povolenie zápisu — vrátane náhľadu, na ktorom sa rozhoduje. */
  function permission(f) {
    breakText();
    err.write('\n');
    err.write(`${c(A.yellow, '⚠ Zápis čaká na povolenie')}  ${c(A.bold, String(f.name))}\n`);
    err.write(`  ${dim(summarizeArgs(f.name, f.arguments))}\n`);

    const preview = typeof f.preview === 'string' ? f.preview : '';
    if (preview.trim() !== '') {
      err.write(colorizeDiff(clip(preview, PREVIEW_LINES, 4000), useColor, '  ') + '\n');
    }
  }

  /**
   * Riadok s možnosťami.
   *
   * Pri `bash` sa DOPÍŠE, čoho sa „vždy" týka: backend povolenie zúži na vzor
   * príkazu (NarrowsAllowance), nie na celé vlákno. Bez tej vety by človek
   * čítal „povoliť vždy" ako „od teraz smie bash všetko" a stlačil by to buď
   * príliš ochotne, alebo nikdy.
   */
  function permissionChoices(f) {
    const always = String(f.name) === 'bash'
      ? c(A.bold, '[v]') + 'ždy ' + dim('(len tento vzor príkazu)')
      : c(A.bold, '[v]') + 'ždy';

    err.write(`  ${c(A.bold, '[p]')}ovoliť · ${always} · ${c(A.bold, '[z]')}amietnuť · ${dim('Esc = zamietnuť')}\n`);
  }

  function turnResult(result) {
    breakText();

    if (result.status === 'end') {
      const e = result.end ?? {};
      const bits = [];
      if (e.tokens_in !== undefined) bits.push(`vstup ${e.tokens_in}`);
      if (e.tokens_out !== undefined) bits.push(`výstup ${e.tokens_out} tok.`);
      if (e.tokens_per_second) bits.push(`${e.tokens_per_second} tok/s`);
      if (e.stop_reason) bits.push(String(e.stop_reason));

      err.write(dim(`· ${bits.join(' · ')}`) + '\n');

      return;
    }

    if (result.status === 'error') {
      // Vetu už vypísal `frame()`; druhýkrát ju netreba.
      return;
    }

    if (result.status === 'aborted') {
      err.write(c(A.yellow, '· beh zastavený (Ctrl+C). To, čo pritieklo, zostáva vyššie.') + '\n');

      return;
    }

    err.write(c(A.red, '· prúd sa skončil bez ukončovacieho rámca — ťah je PRERUŠENÝ, nie dokončený.') + '\n');
  }

  /** Zoznam vlákien. Aktuálne je označené, inak sa v desiatke uuid nedá nájsť. */
  function threadList(threads, currentUuid = null) {
    breakText();

    if (!Array.isArray(threads) || threads.length === 0) {
      err.write(dim('Žiadne vlákna. Prvá správa si jedno založí.') + '\n');

      return;
    }

    for (const t of threads) {
      const mark = t.uuid === currentUuid ? c(A.cyan, '›') : ' ';
      err.write(`${mark} ${dim(String(t.uuid))}  ${String(t.title ?? 'Nové vlákno')}`
        + `  ${dim(relativeTime(t.last_message_at))}${t.model ? dim(' · ' + t.model) : ''}\n`);
    }
  }

  /**
   * Ponuka modelov.
   *
   * `unavailable` zo servera je len meno poskytovateľa, bez dôvodu — dôvod
   * dopisuje klient, pretože sú na tomto stroji len dva a mlčanie typu
   * „anthropic: nedostupný" núti človeka hľadať v kóde.
   */
  function modelList(payload) {
    breakText();

    const models = Array.isArray(payload?.models) ? payload.models : [];
    const def = payload?.default ?? {};

    if (models.length === 0) {
      err.write(c(A.yellow, 'Žiadny model nie je k dispozícii.') + '\n');
    }

    for (const m of models) {
      const isDefault = m.provider === def.provider && m.id === def.model;
      err.write(`${isDefault ? c(A.cyan, '›') : ' '} ${String(m.label ?? m.id)}  ${dim(String(m.provider))}`
        + `${isDefault ? dim(' · default') : ''}\n`);
    }

    const missing = Array.isArray(payload?.unavailable) ? payload.unavailable : [];
    for (const name of missing) {
      err.write(`${c(A.yellow, '✗')} ${String(name)}  ${dim(unavailableReason(String(name)))}\n`);
    }
  }

  return {
    write,
    note,
    frame,
    permission,
    permissionChoices,
    turnResult,
    threadList,
    modelList,
    breakText,
    color: useColor,
    plain: (text) => { breakText(); err.write(text + '\n'); },
    heading: (text) => { breakText(); err.write(c(A.bold, text) + '\n'); },
    warn: (text) => { breakText(); err.write(c(A.yellow, text) + '\n'); },
    fail: (text) => { breakText(); err.write(c(A.red, text) + '\n'); },
    hint: (text) => { breakText(); err.write(dim(text) + '\n'); },
  };
}

/**
 * Vyhrabe systémový kód chyby zo spojenia.
 *
 * `fetch` hodí `TypeError: fetch failed` a skutočný dôvod schová do `cause` —
 * a keď Node skúšal IPv4 aj IPv6, tak do `AggregateError.errors` vnútri `cause`.
 * Bez prehrabania sa používateľ dozvie iba „fetch failed", čo je presne to, čo
 * nepotrebuje vedieť.
 */
export function causeCode(error, seen = new Set()) {
  let current = error;

  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);

    if (typeof current.code === 'string') return current.code;

    if (Array.isArray(current.errors)) {
      for (const inner of current.errors) {
        const found = causeCode(inner, seen);
        if (found !== null) return found;
      }
    }

    current = current.cause;
  }

  return null;
}

/**
 * Chyba spojenia ako veta, s ktorou sa dá konať.
 *
 * @returns {string[]} riadky
 */
export function describeNetworkError(error, cfg) {
  const code = causeCode(error);
  const lines = [`Nepodarilo sa spojiť so serverom: ${error.message}${code === null ? '' : ` (${code})`}`];

  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === null) {
    lines.push(`Beží appka na ${cfg?.url ?? 'tejto adrese'}? (\`docker compose ps\`)`);
  } else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    lines.push(`Meno hosta z adresy ${cfg?.url ?? ''} sa nedá preložiť.`);
  } else if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') {
    lines.push('Spojenie vypršalo. Model na CPU odpovedá dlho, ale spojenie sa má nadviazať hneď — skontroluj adresu.');
  }

  return lines;
}

/**
 * Prečo je poskytovateľ nedostupný.
 *
 * Server pošle len jeho meno (`ModelController`), takže dôvod je tu odhad — ale
 * odhad, ktorý na tomto stroji platí a dá sa podľa neho hneď konať.
 */
export function unavailableReason(provider) {
  if (provider === 'anthropic') return 'chýba ANTHROPIC_API_KEY v .env appky';
  if (provider === 'ollama') return 'Ollama neodpovedá (default http://host.docker.internal:11434)';

  return 'poskytovateľ sa nehlási';
}

/** „pred 3 h" sa v zozname vlákien čita rýchlejšie než ISO timestamp. */
export function relativeTime(iso) {
  if (typeof iso !== 'string' || iso === '') return 'bez správ';

  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'bez správ';

  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 90) return 'práve teraz';
  if (s < 5400) return `pred ${Math.round(s / 60)} min`;
  if (s < 172800) return `pred ${Math.round(s / 3600)} h`;

  return `pred ${Math.round(s / 86400)} d`;
}

/** ms → čitateľný čas; pod sekundu má zmysel milisekunda, nad ňou nie. */
export function duration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0 ms';

  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

/**
 * Kľúčové argumenty toolu v jednom riadku.
 *
 * Vypisovať celý JSON by pri `write_file` znamenalo vysypať na obrazovku celý
 * obsah súboru — teda presne to, čo náhľad rieši lepšie.
 */
export function summarizeArgs(name, args) {
  const a = args && typeof args === 'object' ? args : {};
  const one = (v) => oneLine(String(v));

  switch (name) {
    case 'bash':
      return one(a.command ?? '');
    case 'read_file':
      return [one(a.path ?? ''), a.offset ? `od ${a.offset}` : null, a.limit ? `${a.limit} r.` : null].filter(Boolean).join(' · ');
    case 'grep':
    case 'ripgrep':
      return [a.pattern ? `/${one(a.pattern)}/` : null, one(a.path ?? '.'), a.glob ? one(a.glob) : null].filter(Boolean).join(' v ');
    case 'glob':
      return one(a.pattern ?? '');
    case 'write_file':
    case 'edit_file':
    case 'write_report':
      return one(a.path ?? a.title ?? '');
    default: {
      // Fallback pre mind_* a čokoľvek, čo pribudne: prvé dva skalárne argumenty.
      const parts = [];
      for (const [k, v] of Object.entries(a)) {
        if (v === null || typeof v === 'object') continue;
        parts.push(`${k}=${one(v)}`);
        if (parts.length === 2) break;
      }

      return parts.join(' · ');
    }
  }
}

function oneLine(text) {
  const flat = text.replace(/\s+/g, ' ').trim();

  return flat.length > 140 ? flat.slice(0, 139) + '…' : flat;
}

/**
 * Skráti text a POVIE, že skrátil.
 *
 * Tiché strihnutie je horšie než dlhý výpis: model povie „test prešiel" a v
 * odstrihnutom zvyšku je riadok o tom, že tri padli.
 */
export function clip(text, maxLines, maxChars) {
  let body = text;
  let cutChars = 0;

  if (body.length > maxChars) {
    cutChars = body.length - maxChars;
    body = body.slice(0, maxChars);
  }

  const lines = body.split('\n');
  const cutLines = lines.length > maxLines ? lines.length - maxLines : 0;
  const kept = cutLines > 0 ? lines.slice(0, maxLines) : lines;

  if (cutLines === 0 && cutChars === 0) return kept.join('\n');

  const what = cutLines > 0
    ? `… skrátené: ešte ${cutLines} ${cutLines === 1 ? 'riadok' : 'riadkov'}`
    : `… skrátené: ešte ${cutChars} znakov`;

  return [...kept, `${what} (celý výsledok je vo vlákne)`].join('\n');
}

function indent(text, pad) {
  return text.split('\n').map((l) => pad + l).join('\n');
}

/**
 * Diff náhľad: `+` zeleno, `-` červeno.
 *
 * Hlavičky (`+++`, `---`, `@@`) sa farbia inak než telo — inak vyzerá hlavička
 * `--- a/súbor` ako zmazaných 12 riadkov a náhľad zavádza.
 */
export function colorizeDiff(text, useColor = true, pad = '') {
  return text.split('\n').map((line) => {
    if (!useColor) return pad + line;

    if (line.startsWith('+++') || line.startsWith('---')) return pad + A.dim + line + A.reset;
    if (line.startsWith('@@')) return pad + A.cyan + line + A.reset;
    if (line.startsWith('+')) return pad + A.green + line + A.reset;
    if (line.startsWith('-')) return pad + A.red + line + A.reset;

    return pad + line;
  }).join('\n');
}

/**
 * Preklad HTTP chyby na vetu, s ktorou sa dá niečo urobiť.
 *
 * 401 a 403 majú na tomto okruhu DVE úplne rozdielne príčiny (zlý token vs.
 * nesprávna cesta k serveru) a bez tohto vysvetlenia sa druhá z nich hľadá
 * hodiny. Hlavičky sa nevypisujú — nesú tajomstvo.
 */
export function describeHttpError(error, cfg) {
  const server = error.serverMessage;
  const lines = [];

  if (error.status === 401) {
    lines.push('Server odmietol token (401).');
    lines.push('  · token sa nezhoduje s HADES_UI_TOKEN v .env appky, alebo je v konfigu appky prázdny (vtedy je zamknuté pre všetkých),');
    lines.push(`  · zdroj tokenu, ktorý som použil: ${cfg?.tokenSource ?? 'neznámy'} — over `
      + 'práve tento, nie ten druhý.');
  } else if (error.status === 403) {
    lines.push('Server prijal token, ale odmietol cestu (403).');
    lines.push('  · programový okruh konzoly je LOOPBACK-ONLY: musí ísť z tohto stroja na localhost,');
    lines.push('  · a nesmie prejsť cez proxy ani ngrok tunel (Caddy pridáva X-Forwarded-* a to je diskvalifikácia).');
    if (cfg && !cfg.loopback) lines.push(`  · adresa ${cfg.url} nie je loopback — práve to je najpravdepodobnejšia príčina.`);
  } else if (error.status === 404) {
    lines.push('Taká routa na serveri nie je (404).');
    lines.push('  · beží na tejto adrese vetva, ktorá konzolu má? `/api/console/cli/*` existuje len tam, kde je vlna konzoly nasadená.');
  } else if (error.status === 419) {
    lines.push('Server čakal session a CSRF (419) — to je webový okruh, nie programový.');
    lines.push('  · klient musí volať `/api/console/cli/*`, nie `/api/console/*`.');
  } else if (error.status === 429) {
    lines.push('Priveľa ťahov za minútu (429). Skús o chvíľu.');
  } else {
    lines.push(`Server odpovedal HTTP ${error.status}.`);
  }

  if (server !== null) lines.push(`  · server hovorí: ${server}`);

  return lines.join('\n');
}
