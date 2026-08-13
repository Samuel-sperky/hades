#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Hades MCP — most stdio ↔ Streamable HTTP.
//
// Hades hovorí MCP cez HTTP (POST /mcp, JSON-RPC 2.0, stateless). Klienti, ktorí
// lokálny MCP server SPÚŠŤAJÚ ako proces (aplikácia Claude, Claude Code
// `--transport stdio`), však hovoria po stdin/stdout. Tento skript preposiela
// riadky JSON-RPC medzi nimi — nič viac.
//
// Prečo to chceme, keď ngrok cesta funguje:
//   - žiadny tunel a žiadna Caddy basic-auth v ceste (menej vecí, čo môže padnúť),
//   - token ide v hlavičke `Authorization: Bearer`, NIE v query stringu, takže
//     nekončí v access logoch ani v histórii URL (viď docs/BEZPECNOST.md §8.3),
//   - keď je PC offline, Hades je stále dostupný.
//
// Použitie:
//   node bin/hades-mcp-stdio.mjs
//
// Konfigurácia (env, oboje nepovinné):
//   HADES_MCP_TOKEN  token pre /mcp; keď chýba, prečíta sa z .env v koreni repa
//   HADES_MCP_URL    default http://localhost:8080/mcp
//
// Bez tokenu skript zámerne skončí chybou — guard na serveri je fail-closed
// (prázdny token = 401 pre všetkých), takže tichý beh by len maskoval problém.
// -----------------------------------------------------------------------------

import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = process.env.HADES_MCP_URL || 'http://localhost:8080/mcp';
const TIMEOUT_MS = 120_000;

/** Token z env, inak z .env v koreni repa (hodnotu nikam nevypisujeme). */
function resolveToken() {
  const fromEnv = (process.env.HADES_MCP_TOKEN || '').trim();
  if (fromEnv !== '') return fromEnv;

  try {
    const raw = readFileSync(join(REPO_ROOT, '.env'), 'utf8');
    const line = raw.split(/\r?\n/).find((l) => /^\s*HADES_MCP_TOKEN\s*=/.test(l));
    if (!line) return '';

    return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
  } catch {
    return '';
  }
}

const TOKEN = resolveToken();

if (TOKEN === '') {
  process.stderr.write(
    'hades-mcp-stdio: chýba HADES_MCP_TOKEN (ani v env, ani v .env). '
      + 'Guard na /mcp je fail-closed, bez tokenu by každé volanie skončilo na 401.\n',
  );
  process.exit(1);
}

/** Zapíše jednu JSON-RPC odpoveď na stdout (framing = jeden riadok = jedna správa). */
function emit(payload) {
  process.stdout.write(JSON.stringify(payload) + '\n');
}

/** JSON-RPC chyba pre správu, ktorá má `id`; notifikácia ide len do stderr. */
function fail(id, message) {
  if (id === undefined || id === null) {
    process.stderr.write(`hades-mcp-stdio: ${message}\n`);
    return;
  }

  emit({ jsonrpc: '2.0', id, error: { code: -32603, message } });
}

async function forward(message, id) {
  let response;

  try {
    response = await fetch(URL_, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const reason = e?.name === 'TimeoutError'
      ? `Hades neodpovedal do ${TIMEOUT_MS / 1000} s`
      : `Hades je nedostupný na ${URL_} (${e?.cause?.code || e?.cause?.message || e?.message || 'chyba spojenia'})`;

    fail(id, `${reason}. Beží docker compose?`);
    return;
  }

  if (response.status === 401) {
    fail(id, 'Hades odmietol token (401) — HADES_MCP_TOKEN nesedí s hodnotou na serveri.');
    return;
  }

  // 202/204 = notifikácia prijatá, server nemá čo vrátiť → na stdout nič nesmie ísť
  const body = (await response.text()).trim();
  if (body === '') return;

  if (!response.ok) {
    fail(id, `Hades vrátil HTTP ${response.status}.`);
    return;
  }

  try {
    emit(JSON.parse(body));
  } catch {
    fail(id, `Hades vrátil odpoveď, ktorá nie je JSON (HTTP ${response.status}).`);
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

/**
 * Rozbehnuté requesty. PASCA: `process.exit()` v `close` handleri zabil fetch-e,
 * ktoré ešte leteli — pri dávke správ (initialize + tools/list naraz) stdin zavrie
 * skôr, než prvá odpoveď dorazí, a klient nedostal NIČ. Preto sa pri zatvorení
 * stdin čaká na dobehnutie a proces sa ukončí sám, keď nemá čo robiť.
 */
const inflight = new Set();

lines.on('line', (line) => {
  const trimmed = line.trim();
  if (trimmed === '') return;

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    // nevalidný vstup nikdy nezhodí most — klient by stratil celé spojenie
    process.stderr.write('hades-mcp-stdio: preskočený riadok, ktorý nie je JSON.\n');
    return;
  }

  // odpovede sa párujú podľa `id`, takže správy sa môžu vybavovať paralelne
  const pending = forward(message, Array.isArray(message) ? undefined : message?.id);
  inflight.add(pending);
  void pending.finally(() => inflight.delete(pending));
});

lines.on('close', async () => {
  while (inflight.size > 0) {
    await Promise.allSettled([...inflight]);
  }
});
