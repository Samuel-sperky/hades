// -----------------------------------------------------------------------------
// Stub servera konzoly — `node:http`, žiadna závislosť.
//
// Prečo stub a nie skutočná appka: routy `/api/console/cli/*` sú len na vetve
// `feat/hades-klient`, kým na 8080 beží hlavná vetva, takže test proti nej by
// meral 404 a hlásil ho ako chybu klienta. A hlavne: prúd sa proti stubu dá
// rozsekať na PRESNE tie chunky, ktoré chcem — rozpolený JSON objekt a rozpolený
// viacbajtový znak sú dvojica chýb, ktoré sa v prevádzke prejavia raz za mesiac
// a inak sa nedajú vyvolať zámerne.
//
// Stub si pamätá volania (`calls`), takže sa dá overiť aj to, čo klient POSLAL —
// nie len to, čo vykreslil. Pri `permission` → `/decide` je práve telo requestu
// to podstatné.
// -----------------------------------------------------------------------------

import { createServer } from 'node:http';

/** Pauza medzi chunkami, aby ich TCP nezliepal do jedného čítania. */
const CHUNK_DELAY_MS = 10;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** JSON odpoveď. */
export function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

/**
 * Pošle presne tie chunky, ktoré dostane — bez toho, aby ich zlepila.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {Array<string|Uint8Array>} chunks
 */
export async function sendChunks(res, chunks) {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });

  for (const chunk of chunks) {
    res.write(chunk);
    await sleep(CHUNK_DELAY_MS);
  }

  res.end();
}

/** Rámce → riadky NDJSON, jeden chunk na rámec. */
export function frames(...list) {
  return list.map((frame) => JSON.stringify(frame) + '\n');
}

/**
 * @param {Record<string, (ctx: {req: any, res: any, body: any, calls: any[]}) => any>} routes
 *        kľúč je `"POST /api/…"` alebo len cesta
 */
export async function startStub(routes = {}) {
  const calls = [];

  const server = createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });

    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://stub');
      let body = null;

      if (raw !== '') {
        try { body = JSON.parse(raw); } catch { body = raw; }
      }

      calls.push({
        method: req.method,
        path: url.pathname,
        body,
        // Len prítomnosť, nie hodnota — v teste nemá čo prezradiť.
        hasToken: typeof req.headers['x-hades-ui-token'] === 'string',
      });

      const handler = routes[`${req.method} ${url.pathname}`] ?? routes[url.pathname];

      if (handler === undefined) {
        sendJson(res, 404, { message: 'Taká routa v stube nie je.' });

        return;
      }

      Promise.resolve(handler({ req, res, body, calls })).catch((error) => {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(String(error?.message ?? error));
      });
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = /** @type {{port: number}} */ (server.address());

  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    async close() {
      // Bez zavretia keep-alive spojení `close()` čaká, kým ich klient pustí sám —
      // a test by skončil timeoutom namiesto výsledku.
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** Zberač výstupu namiesto `process.stdout`. */
export function sink() {
  return {
    text: '',
    isTTY: false,
    write(chunk) { this.text += String(chunk); return true; },
  };
}
