// -----------------------------------------------------------------------------
// Odkiaľ klient vezme adresu a token.
//
// Poradie je zámerné a `hades doctor` ho musí vedieť povedať nahlas: keď klient
// hovorí s iným Hadesom, než si používateľ myslí, je to najdrahšia možná chyba —
// vlákna sú inde, tooly píšu inde, a nič z toho nevyzerá ako porucha.
//
//   1. env HADES_URL / HADES_UI_TOKEN   — jednorazový beh, CI, skript
//   2. ~/.hades/config.json             — klient spustený mimo repa
//   3. .env projektu                    — hlavná cesta na tomto stroji
//
// Prečo je .env POSLEDNÝ a zároveň hlavný: používateľ nemá prečo tajomstvo
// kopírovať do druhého súboru, ale keď si ho niekam skopíruje alebo prepíše
// premennou, tá kópia musí vyhrať — inak sa nedá nič odladiť.
//
// Každé pole sa hľadá SAMOSTATNE, nie ako celý balík z jedného zdroja. Dôvod:
// `.env` nesie token, ale adresu appky pod iným menom (`APP_URL`), a env
// premenná typicky nesie len jedno z toho. Balíkové hľadanie by pri
// `HADES_URL=…` v shelli zahodilo token z `.env` a klient by hlásil, že token
// nemá — hoci ho má.
//
// Hodnota tokenu sa z tohto modulu NIKDY nevypisuje. Von ide len meno zdroja.
// -----------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** Keď adresu nepovie nikto: appka na tomto stroji beží tu. */
export const DEFAULT_URL = 'http://localhost:8080';

/** Adresy, ktoré programový okruh konzoly vôbec pustí (viď AuthenticateConsoleToken). */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Prečíta `.env`-ovský súbor do mapy.
 *
 * Nie je to plný dotenv: interpolácia (`${VAR}`) ani viacriadkové hodnoty tu
 * netreba a ich podpora by len pridala spôsoby, ako z tokenu vyrobiť nesprávny
 * token. Úvodzovky sa strhávajú, pretože Laravel ich do `.env` píše sám.
 *
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function parseEnvFile(text) {
  const out = new Map();

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"') && value.length > 1)
      || (value.startsWith("'") && value.endsWith("'") && value.length > 1)) {
      value = value.slice(1, -1);
    } else {
      // Komentár za hodnotou strhávame len keď je oddelený medzerou. Bez tej
      // podmienky by sa z tokenu, ktorý `#` obsahuje, stal jeho prefix — a to je
      // chyba, ktorá sa prejaví až ako 401 od servera.
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trimEnd();
    }

    out.set(key, value);
  }

  return out;
}

/**
 * Nájde koreň Laravel projektu stúpaním z `cwd` nahor.
 *
 * Hľadá priečinok, kde je `artisan` AJ `.env` — nie iba `.env`. Samotný `.env`
 * má aj hocijaký iný projekt a klient by z neho čítal cudzí token; `artisan`
 * hovorí, že je to Laravel, teda toto repo.
 *
 * @param {string} cwd
 * @returns {string|null}
 */
export function findProjectRoot(cwd) {
  let dir = resolve(cwd);

  for (;;) {
    if (existsSync(join(dir, 'artisan')) && existsSync(join(dir, '.env'))) return dir;

    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** @returns {{url?: string, token?: string}} */
function readUserConfig(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));

    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // Rozbitý alebo chýbajúci `~/.hades/config.json` nie je dôvod skončiť —
    // klient má ešte `.env`. Traceback z JSON.parse by len zakryl, že cesta
    // číslo 3 by bola prešla.
    return {};
  }
}

/**
 * Zistí adresu, token a ODKIAĽ sú.
 *
 * Argumenty sa dajú podstrčiť, aby sa poradie zdrojov dalo otestovať bez
 * prepisovania skutočného `~/.hades` a bez závislosti na tom, odkiaľ testy bežia.
 *
 * @param {{env?: Record<string, string|undefined>, home?: string, cwd?: string}} [deps]
 */
export function resolveConfig({ env = process.env, home = homedir(), cwd = process.cwd() } = {}) {
  const userPath = join(home, '.hades', 'config.json');
  const user = existsSync(userPath) ? readUserConfig(userPath) : null;

  const projectRoot = findProjectRoot(cwd);
  let projectEnv = null;

  if (projectRoot !== null) {
    try {
      projectEnv = parseEnvFile(readFileSync(join(projectRoot, '.env'), 'utf8'));
    } catch {
      projectEnv = null;
    }
  }

  const url = pick([
    ['premenná prostredia HADES_URL', env.HADES_URL],
    [`${userPath} (url)`, user?.url],
    [projectRoot === null ? '.env projektu (APP_URL)' : `${join(projectRoot, '.env')} (APP_URL)`, projectEnv?.get('APP_URL')],
  ]);

  const token = pick([
    ['premenná prostredia HADES_UI_TOKEN', env.HADES_UI_TOKEN],
    [`${userPath} (token)`, user?.token],
    [projectRoot === null ? '.env projektu (HADES_UI_TOKEN)' : `${join(projectRoot, '.env')} (HADES_UI_TOKEN)`, projectEnv?.get('HADES_UI_TOKEN')],
  ]);

  const resolvedUrl = url.value === null ? DEFAULT_URL : stripSlash(url.value);

  return {
    url: resolvedUrl,
    token: token.value,
    urlSource: url.value === null ? `default (${DEFAULT_URL})` : url.source,
    tokenSource: token.source,
    projectRoot,
    userConfigPath: existsSync(userPath) ? userPath : null,
    /** Okruh je loopback-only, takže vzdialená adresa je istá 403 — a chceme to povedať skôr. */
    loopback: isLoopback(resolvedUrl),
  };
}

/**
 * Prvý neprázdny zdroj vyhráva.
 *
 * @param {Array<[string, string|undefined|null]>} candidates
 * @returns {{value: string|null, source: string|null}}
 */
function pick(candidates) {
  for (const [source, raw] of candidates) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value !== '') return { value, source };
  }

  return { value: null, source: null };
}

function stripSlash(url) {
  return url.replace(/\/+$/, '');
}

function isLoopback(url) {
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Veta, ktorou sa dá pokračovať, keď token nikde nie je.
 *
 * Zámerne návod a nie traceback: chýbajúci token nie je pád programu, je to
 * nedokončené nastavenie a používateľ potrebuje vedieť, čo doplniť.
 */
export function setupHint(cfg) {
  const lines = [
    'Nenašiel som token pre konzolu Hadesa. Klient sa bez neho nemá čím prihlásiť.',
    '',
    'Sprav jedno z týchto (poradie = priorita):',
    '  1) export HADES_UI_TOKEN=… (a nepovinne HADES_URL=http://localhost:8080)',
    '  2) ~/.hades/config.json    {"url": "http://localhost:8080", "token": "…"}',
    '  3) spusti `hades` z priečinka projektu — token si vezme z jeho .env (HADES_UI_TOKEN)',
  ];

  if (cfg.projectRoot === null) {
    lines.push('', 'Projekt (priečinok s `artisan` a `.env`) som nad aktuálnym priečinkom nenašiel.');
  } else {
    lines.push('', `Projekt som našel v ${cfg.projectRoot}, ale HADES_UI_TOKEN v jeho .env nie je vyplnený.`);
  }

  return lines.join('\n');
}
