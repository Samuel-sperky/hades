// -----------------------------------------------------------------------------
// HTTP a čítanie NDJSON prúdu. Tento modul vie protokol a nič o obrazovke.
//
// Protokol (`docs` v routes/api.php, AgentRunner): jeden JSON objekt na riadok,
// diskriminátor je `t`. Dve pravidlá, na ktorých stojí celý klient:
//
//   • ťah končí PRESNE jedným rámcom `end` alebo `error`,
//   • rámec `permission` ťah ukončí BEZ `end` — beh je zaparkovaný a dostreamuje
//     ho `POST /console/cli/decide`, ktorý vracia ten istý prúd.
//
// Preto tu nie je „prečítaj prúd", ale `driveTurn()`: ťah je z pohľadu človeka
// jedna vec, aj keď je to na drôte niekoľko requestov za sebou. Kto by si
// parkovanie riešil u seba, zabudne na to v druhom volajúcom.
//
// Neznámy typ rámca sa ticho ignoruje — protokol sa rozširuje aditívne a starší
// klient nesmie na novom rámci spadnúť. `readNdjson()` preto vydáva všetko, čo
// sa dá rozparsovať na objekt, a rozhodnutie „nepoznám, nechám" patrí tomu, kto
// rámce spracúva.
// -----------------------------------------------------------------------------

/** Hlavička programového okruhu konzoly (AuthenticateConsoleToken::HEADER). */
export const TOKEN_HEADER = 'X-Hades-Ui-Token';

/**
 * Strop preskokov permission → decide v jednom ťahu.
 *
 * Nie je to obrana proti serveru, ale proti smyčke bez konca: keby `decide`
 * vrátil znova ten istý `permission` (napr. po chybe na strane servera), klient
 * by sa používateľa pýtal donekonečna a nedal by sa ani prerušiť rozumne.
 */
const MAX_PERMISSION_HOPS = 64;

export class HadesHttpError extends Error {
  /**
   * @param {number} status
   * @param {string} path
   * @param {unknown} body rozparsované telo, keď to bol JSON, inak text
   */
  constructor(status, path, body) {
    super(`HTTP ${status} na ${path}`);
    this.name = 'HadesHttpError';
    this.status = status;
    this.path = path;
    this.body = body;
  }

  /** Veta zo servera, keď ju poslal — server hovorí po slovensky. */
  get serverMessage() {
    if (this.body && typeof this.body === 'object') {
      const b = /** @type {Record<string, unknown>} */ (this.body);
      for (const key of ['error', 'message']) {
        if (typeof b[key] === 'string' && b[key] !== '') return /** @type {string} */ (b[key]);
      }
    }

    return typeof this.body === 'string' && this.body.trim() !== '' ? this.body.trim() : null;
  }
}

/** Prerušenie z Ctrl+C nie je chyba behu, treba ho rozoznať od skutočnej chyby. */
export function isAbortError(error) {
  return error instanceof Error && (error.name === 'AbortError' || error.code === 'ABORT_ERR');
}

/**
 * Klient nad jednou adresou a jedným tokenom.
 *
 * @param {{url: string, token: string, fetchImpl?: typeof fetch}} options
 */
export function createClient({ url, token, fetchImpl = fetch }) {
  const base = url.replace(/\/+$/, '');

  const headers = () => ({
    [TOKEN_HEADER]: token,
    Accept: 'application/json',
  });

  async function request(path, { method = 'GET', body, signal } = {}) {
    const init = { method, headers: headers(), signal };

    if (body !== undefined) {
      init.headers = { ...init.headers, 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }

    return fetchImpl(base + path, init);
  }

  /** JSON volanie — nesprávny stav je výnimka, nie tichá `undefined`. */
  async function json(path, options = {}) {
    const response = await request(path, options);
    const text = await response.text();
    let parsed = text;

    try {
      parsed = text === '' ? null : JSON.parse(text);
    } catch {
      // necháme text — chybová stránka od proxy nie je JSON a jej obsah je
      // pri diagnostike užitočnejší než „neplatný JSON"
    }

    if (!response.ok) throw new HadesHttpError(response.status, path, parsed);

    return parsed;
  }

  /**
   * NDJSON prúd ako async generátor rámcov.
   *
   * Nesprávny stav sa vyhodí ešte pred prvým rámcom, takže volajúci sa nedozvie
   * o 401 až po tom, čo nakreslil prázdny ťah.
   *
   * @returns {AsyncGenerator<Record<string, unknown>>}
   */
  async function* stream(path, body, { signal } = {}) {
    const response = await request(path, { method: 'POST', body, signal });

    if (!response.ok) {
      const text = await response.text();
      let parsed = text;
      try {
        parsed = text === '' ? null : JSON.parse(text);
      } catch { /* viď vyššie */ }

      throw new HadesHttpError(response.status, path, parsed);
    }

    if (response.body === null) return;

    yield* readNdjson(response.body);
  }

  return { base, json, stream, get: (path, o) => json(path, o), post: (path, body, o) => json(path, { ...o, method: 'POST', body }) };
}

/**
 * Rozreže prúd bajtov na rámce.
 *
 * Dve pasce, ktoré tu MUSIA byť vyriešené naraz, lebo sa prejavia až v prevádzke:
 *
 *  • JSON objekt rozdelený medzi dva chunky — preto textový buffer a rámec sa
 *    vydá až po znaku nového riadku, nikdy „čo prišlo v tomto chunku",
 *  • viacbajtový znak (slovenská diakritika) rozdelený medzi dva chunky — preto
 *    `TextDecoder` so `{ stream: true }` a nie `buf.toString('utf8')`. Ten by
 *    z rozpolenej sekvencie vyrobil U+FFFD a odpoveď by sa tichom pokazila
 *    presne na tých slovách, kde je diakritika.
 *
 * @param {ReadableStream<Uint8Array>} body
 */
export async function* readNdjson(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);

        const frame = parseFrame(line);
        if (frame !== null) yield frame;
      }
    }

    buffer += decoder.decode();

    // Posledný riadok bez `\n` je legitímny: server flushuje po každom rámci a
    // spojenie môže skončiť hneď za ním.
    const frame = parseFrame(buffer);
    if (frame !== null) yield frame;
  } finally {
    // Bez toho by pri predčasnom ukončení (`break` u volajúceho, Ctrl+C) zostal
    // reader zamknutý a socket otvorený.
    try { reader.releaseLock(); } catch { /* už uvoľnený */ }
  }
}

/** @returns {Record<string, unknown>|null} */
function parseFrame(line) {
  const text = line.trim();
  if (text === '') return null;

  try {
    const parsed = JSON.parse(text);

    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    // Nedoparsovaný riadok zahodíme mlčky. Nie je z čoho ho poskládať a hlásiť
    // to používateľovi by znamenalo krik pri každom nedokončenom prúde.
    return null;
  }
}

/** Ako ťah skončil. `interrupted` je prúd bez `end` aj bez `error` — teda strata spojenia. */
export const TURN_END = 'end';
export const TURN_ERROR = 'error';
export const TURN_ABORTED = 'aborted';
export const TURN_INTERRUPTED = 'interrupted';

/**
 * Jeden ťah vrátane parkovania na povolenie.
 *
 * @param {object} options
 * @param {ReturnType<typeof createClient>} options.client
 * @param {{thread: string, message: string, model?: string|null, provider?: string|null}} options.body
 * @param {(frame: Record<string, unknown>) => void} [options.onFrame]
 * @param {(frame: Record<string, unknown>) => Promise<string>|string} [options.onPermission]
 *        vráti 'allow' | 'allow_always' | 'deny'
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{status: string, end?: object, error?: object, decisions: string[]}>}
 */
export async function driveTurn({ client, body, onFrame, onPermission, signal }) {
  let path = '/api/console/cli/run';
  let payload = { ...body };
  const decisions = [];

  for (let hop = 0; hop <= MAX_PERMISSION_HOPS; hop += 1) {
    let parked = null;

    try {
      for await (const frame of client.stream(path, payload, { signal })) {
        onFrame?.(frame);

        if (frame.t === TURN_END) return { status: TURN_END, end: frame, decisions };
        if (frame.t === TURN_ERROR) return { status: TURN_ERROR, error: frame, decisions };

        if (frame.t === 'permission') {
          // Server za týmto rámcom prúd zavrie. Čakať na ďalšie rámce by
          // znamenalo držať otázku pre človeka za mŕtvym socketom.
          parked = frame;
          break;
        }
      }
    } catch (error) {
      if (isAbortError(error)) return { status: TURN_ABORTED, decisions };
      throw error;
    }

    if (parked === null) return { status: TURN_INTERRUPTED, decisions };

    if (typeof onPermission !== 'function') {
      // Bez rozhodovača sa ťah nedá dokončiť a `deny` naslepo by za používateľa
      // rozhodol niečo, čo nechcel. Radšej priznaná nedokončenosť.
      return { status: TURN_INTERRUPTED, decisions };
    }

    const decision = await onPermission(parked);
    decisions.push(decision);

    payload = { thread: body.thread, call: parked.id, decision };
    path = '/api/console/cli/decide';
  }

  return { status: TURN_INTERRUPTED, decisions };
}

/**
 * Vlákno, v ktorom sa má pokračovať.
 *
 * @param {ReturnType<typeof createClient>} client
 * @param {{thread?: string|null, fresh?: boolean, model?: string|null, provider?: string|null}} options
 */
export async function resolveThread(client, { thread = null, fresh = false, model = null, provider = null } = {}) {
  if (thread !== null && thread !== '') return client.get(`/api/console/cli/threads/${thread}`);

  if (!fresh) {
    const list = await client.get('/api/console/cli/threads');
    const first = Array.isArray(list?.threads) ? list.threads[0] : null;

    // Zoznam je zoradený podľa `last_message_at` DESC, takže prvý je ten, v
    // ktorom sa naposledy hovorilo — a to je to, čo „pokračuj" znamená.
    if (first?.uuid) return client.get(`/api/console/cli/threads/${first.uuid}`);
  }

  const created = { };
  if (provider) created.provider = provider;
  if (model) created.model = model;

  return client.post('/api/console/cli/threads', created);
}
