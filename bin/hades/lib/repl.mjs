// -----------------------------------------------------------------------------
// Interaktívna smyčka a potvrdzovanie zápisov.
//
// ── Kľúčové pravidlo: stdin má v každom okamihu PRESNE JEDNÉHO vlastníka ─────
//
// Na prompte ho vlastní `readline`, počas ťahu ho vlastní `keyboard`. Preto sa
// `readline` interface pre každý prompt vyrába nanovo a po odpovedi sa zatvára
// (história sa prenáša cez `history`). Verzia, kde `readline` len „spal" a druhý
// `data` listener čítal ten istý stream, mala dve chyby naraz a obe tiché:
//
//   • `readline.pause()` zastaví aj podkladový stream (`flowing === false`) a
//     pripojenie ďalšieho `data` listenera ho samo NEROZBEHNE — kláves neprišel
//     nikdy a ťah čakal na povolenie do konca sveta,
//   • keď sa stream rozbehol ručne, bajty dostal AJ `readline` (jeho listener
//     zostáva pripojený) a stlačené „p" skončilo v jeho riadkovom bufferi, takže
//     nasledujúca správa začínala na „p".
//
// ── Ďalšie dve veci, ktoré tu majú byť takto ────────────────────────────────
//
//  • Prvé ^C zastaví BEH (abort requestu), druhé ukončí PROGRAM. Prvé stlačenie
//    nesmie zabiť proces: to, čo už pritieklo, je často to, po čom človek siahol
//    — a s ním aj vlákno, v ktorom sa dá pokračovať.
//
//  • Otázka na povolenie zápisu je JEDNO stlačenie klávesu, nie riadok s Enter.
//    Je to jediné miesto, kde beh stojí a čaká na človeka, a Enter navyše je tu
//    daň, ktorú platí každý zápis.
// -----------------------------------------------------------------------------

import { createInterface } from 'node:readline';

import { HadesHttpError, driveTurn } from './api.mjs';
import { describeHttpError, describeNetworkError } from './render.mjs';

const KEY_INTERRUPT = '\u0003';
const KEY_ESCAPE = '\u001b';

/**
 * Kláves ako TEXT, nie ako bajty.
 *
 * `readline` si na svojom vstupe zapne utf8 kódovanie a to na streame zostane aj
 * po jeho zatvorení, takže `data` udalosti nesú STRING, nie `Buffer`. Kód, ktorý
 * porovnáva `chunk[0] === 27` alebo `chunk.includes(3)`, teda mlčky nikdy
 * netrafí — „Ctrl+C zastaví beh" vyzerá napísané a nefunguje.
 */
function asText(chunk) {
  return typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
}

/** Klávesa → rozhodnutie. Anglické aliasy sú tu preto, že prsty si `y/n` pamätajú z iných nástrojov. */
const DECISION_KEYS = new Map([
  ['p', 'allow'], ['y', 'allow'],
  ['v', 'allow_always'], ['a', 'allow_always'],
  ['z', 'deny'], ['n', 'deny'], ['d', 'deny'],
]);

export const HELP = [
  '/new              nové vlákno',
  '/threads          zoznam vlákien',
  '/thread <uuid>    prepnutie na iné vlákno',
  '/models           čo je k dispozícii a čo nie',
  '/model <id>       prepnutie modelu (uloží sa aj vláknu, takže ho vidí aj web)',
  '/help             tento výpis',
  '/exit             koniec (aj Ctrl+D)',
];

/**
 * Klávesnica pre čas, keď stdin nevlastní `readline`.
 *
 * @param {{stdin?: NodeJS.ReadStream}} [deps]
 */
export function createKeyboard({ stdin = process.stdin } = {}) {
  /** @type {Array<(key: string) => void>} */
  const waiters = [];
  /** @type {null | (() => void)} */
  let onInterrupt = null;
  /** Text napísaný počas behu, ktorý nikto nečakal — viď `takeTypeAhead()`. */
  let typeAhead = '';

  const onData = (chunk) => {
    const text = asText(chunk);

    // ^C sa vyhodnocuje VŽDY, aj keď na kláves niekto čaká: inak by sa beh
    // uprostred otázky o povolenie nedal zastaviť ničím okrem zabitia procesu.
    if (text.includes(KEY_INTERRUPT) && onInterrupt !== null) onInterrupt();

    const waiter = waiters.shift();
    if (waiter !== undefined) {
      waiter(text);

      return;
    }

    // Nikto nečaká na kláves: človek písal počas behu. Text si podržíme a smyčka
    // ho použije na ďalšom prompte. Bez toho sa napísaná správa NENÁVRATNE
    // stratí — čo je pri odpovedi na dve minúty tá najpravdepodobnejšia chvíľa,
    // kedy človek začne písať ďalšiu.
    typeAhead += sanitize(text);
  };

  const raw = (on) => {
    // Raw mode je podmienka oboch sľubov: bez neho terminál pošle ^C ako signál
    // (proces zomrie namiesto zastavenia behu) a jednotlivý kláves príde až po
    // Enteri.
    if (stdin.isTTY && typeof stdin.setRawMode === 'function') stdin.setRawMode(on);
  };

  return {
    /** Prevezme stdin a vráti funkciu, ktorá ho vráti späť. */
    arm(interruptHandler) {
      onInterrupt = interruptHandler;
      raw(true);
      stdin.on('data', onData);
      // Explicitne, nie „pripojením listenera": stream je po zatvorení readline
      // pauznutý a `on('data')` ho v tom stave sám nerozbehne.
      stdin.resume();

      return () => {
        stdin.removeListener('data', onData);
        stdin.pause();
        raw(false);
        onInterrupt = null;
        waiters.length = 0;
      };
    },
    nextKey() {
      return new Promise((resolve) => waiters.push(resolve));
    },
    /** Vyberie text napísaný počas behu (a vyprázdni ho). */
    takeTypeAhead() {
      const text = typeAhead;
      typeAhead = '';

      return text;
    },
    /** Vráti nespotrebovaný zvyšok späť — napríklad druhý riadok z type-ahead. */
    keepTypeAhead(text) {
      typeAhead = text + typeAhead;
    },
  };
}

/**
 * Čistí type-ahead na to, čo sa dá vložiť do riadku.
 *
 * Escape sekvencie (šípky, funkčné klávesy) by sa inak do správy dostali ako
 * viditeľné „[A" a riadiace znaky by rozbili prompt. `\n` a `\t` zostávajú,
 * `\r\n` sa normalizuje — inak by sa jeden Enter počítal ako dva riadky.
 */
function sanitize(text) {
  return text
    .replace(/\u001b\[[0-9;]*[A-Za-z~]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

/**
 * Jedno stlačenie klávesu → rozhodnutie o zápise.
 *
 * @param {ReturnType<typeof createKeyboard>} keyboard
 * @param {ReturnType<import('./render.mjs').createRenderer>} renderer
 * @param {Record<string, any>} frame
 * @returns {Promise<'allow'|'allow_always'|'deny'>}
 */
export async function askDecision(keyboard, renderer, frame) {
  renderer.permission(frame);

  for (;;) {
    renderer.permissionChoices(frame);
    const pressed = await keyboard.nextKey();

    if (pressed.includes(KEY_INTERRUPT)) return 'deny';
    // Esc je samotný 0x1b; pri šípkach je to len prefix dlhšej sekvencie, takže
    // sa berie iba samostatný Esc — inak by šípka nahor zamietla zápis.
    if (pressed === KEY_ESCAPE) return 'deny';

    const key = pressed.trim().toLowerCase().slice(0, 1);
    const decision = DECISION_KEYS.get(key);
    if (decision !== undefined) return decision;

    renderer.hint('  Nerozumel som. Stlač p, v alebo z.');
  }
}

/**
 * Interaktívny klient. Vracia exit kód.
 *
 * @param {object} options
 * @param {ReturnType<import('./api.mjs').createClient>} options.client
 * @param {ReturnType<import('./render.mjs').createRenderer>} options.renderer
 * @param {{url: string, tokenSource?: string|null, loopback?: boolean}} options.cfg
 * @param {Record<string, any>} options.thread payload vlákna z API
 * @param {string|null} [options.model]
 * @param {NodeJS.ReadStream} [options.stdin]
 * @param {NodeJS.WriteStream} [options.stdout]
 * @returns {Promise<number>}
 */
export async function startRepl({
  client,
  renderer,
  cfg,
  thread,
  model = null,
  stdin = process.stdin,
  stdout = process.stdout,
}) {
  let current = thread;
  let chosenModel = model ?? current.model ?? null;
  let chosenProvider = current.provider ?? null;
  /** História prežije zatvorenie interface — inak je šípka nahor po každom ťahu prázdna. */
  let history = [];
  let exiting = false;

  const keyboard = createKeyboard({ stdin });

  banner();

  for (;;) {
    const { answer, interrupted } = await ask(prompt(renderer.color));

    // ^C na prompte: nič nebeží, takže „zastav beh" nemá čo zastaviť. Spolu
    // s prvým ^C počas behu to dáva sľúbené „druhé Ctrl+C ukončí program".
    if (interrupted) {
      renderer.plain('');
      break;
    }

    if (answer === null || exiting) break;

    const text = answer.trim();
    if (text === '') continue;

    const outcome = text.startsWith('/') ? await slash(text) : await turn(text);
    if (outcome === 'exit') break;
  }

  renderer.hint('Ahoj.');

  return 0;

  // ---- vnútro smyčky ------------------------------------------------------
  // Deklarácie sú `function` (nie `const`), takže sú hoistované a smyčka ich
  // vidí, hoci sú v texte pod ňou. Stav vlákna si berú z closure — inak by ho
  // každá musela dostať parametrom a vrátiť späť.

  /**
   * Jeden riadok od človeka.
   *
   * Interface sa vyrobí a po odpovedi zatvorí — viď hlavička modulu: dvaja
   * vlastníci stdin sú dve tiché chyby.
   *
   * Najprv sa spotrebuje to, čo človek napísal POČAS behu (type-ahead). Celý
   * riadok sa berie tak, akoby ho práve odklepol; rozpísaný zvyšok sa vloží do
   * editora, aby v ňom mohol dopisovať.
   *
   * @returns {Promise<{answer: string|null, interrupted: boolean}>}
   */
  function ask(promptText) {
    const typed = keyboard.takeTypeAhead();
    const newline = typed.indexOf('\n');

    if (newline !== -1) {
      keyboard.keepTypeAhead(typed.slice(newline + 1));
      const line = typed.slice(0, newline);
      stdout.write(promptText + line + '\n');

      return Promise.resolve({ answer: line, interrupted: false });
    }

    const rl = createInterface({
      input: stdin,
      output: stdout,
      terminal: true,
      historySize: 200,
      history,
    });

    return new Promise((resolve) => {
      let settled = false;
      let interrupted = false;

      const finish = (answer) => {
        if (settled) return;
        settled = true;
        history = Array.isArray(rl.history) ? [...rl.history] : history;
        rl.close();
        resolve({ answer, interrupted });
      };

      rl.on('SIGINT', () => { interrupted = true; finish(null); });
      // Ctrl+D a koniec vstupu: `close` bez odpovede musí smyčku ukončiť, nie ju
      // nechať visieť na promise, ktorý sa nikdy nesplní.
      rl.once('close', () => finish(null));
      rl.question(promptText, (answer) => finish(answer));

      // Rozpísaný zvyšok type-ahead ide do editora AŽ po `question()` — pred ním
      // by `readline` nemal kam echo vypísať a znaky by zmizli.
      if (typed !== '') rl.write(typed);
    });
  }

  function banner() {
    const seen = Array.isArray(current.messages) && current.messages.length > 0
      ? `${current.messages.length} správ v histórii`
      : 'nové';

    renderer.heading(`Hades · ${cfg.url}`);
    renderer.hint(`vlákno ${current.uuid} · ${current.title ?? 'Nové vlákno'} · ${seen}`);
    renderer.hint(`model ${chosenModel ?? 'default servera'} · /help vypíše príkazy · Ctrl+C zastaví beh`);
    renderer.plain('');

    if (current.awaiting) {
      renderer.warn('Toto vlákno čaká na rozhodnutie o zápise z web konzoly. Kým sa tam nerozhodne, ďalšia správa doň neprejde.');
    }
  }

  /** Jeden ťah vrátane parkovania na povolenie a Ctrl+C. */
  async function turn(text) {
    const controller = new AbortController();
    let stops = 0;

    const disarm = keyboard.arm(() => {
      stops += 1;

      if (stops === 1) {
        controller.abort();
        renderer.warn('\n· zastavujem beh… (ďalšie Ctrl+C ukončí klienta)');

        return;
      }

      exiting = true;
    });

    try {
      const result = await driveTurn({
        client,
        body: {
          thread: current.uuid,
          message: text,
          model: chosenModel,
          provider: chosenProvider,
        },
        onFrame: (frame) => renderer.frame(frame),
        onPermission: (frame) => askDecision(keyboard, renderer, frame),
        signal: controller.signal,
      });

      renderer.turnResult(result);
    } catch (error) {
      report(error);
    } finally {
      disarm();
    }

    renderer.plain('');

    return exiting ? 'exit' : 'ok';
  }

  /** @returns {Promise<'ok'|'exit'>} */
  async function slash(text) {
    const parts = text.slice(1).split(/\s+/);
    const cmd = (parts.shift() ?? '').toLowerCase();
    const arg = parts.join(' ').trim();

    try {
      switch (cmd) {
        case 'exit':
        case 'quit':
        case 'q':
          return 'exit';

        case 'help':
        case '?':
          for (const line of HELP) renderer.hint(line);
          break;

        case 'new': {
          const created = {};
          if (chosenProvider) created.provider = chosenProvider;
          if (chosenModel) created.model = chosenModel;
          current = await client.post('/api/console/cli/threads', created);
          renderer.plain('');
          banner();
          break;
        }

        case 'threads': {
          const list = await client.get('/api/console/cli/threads');
          renderer.threadList(list?.threads, current.uuid);
          break;
        }

        case 'thread': {
          if (arg === '') {
            renderer.warn('Použitie: /thread <uuid>');
            break;
          }

          current = await client.get(`/api/console/cli/threads/${arg}`);
          chosenModel = current.model ?? chosenModel;
          chosenProvider = current.provider ?? chosenProvider;
          renderer.plain('');
          banner();
          break;
        }

        case 'models':
          renderer.modelList(await client.get('/api/console/cli/models'));
          break;

        case 'model': {
          if (arg === '') {
            renderer.warn('Použitie: /model <id> · /models vypíše, čo je k dispozícii');
            break;
          }

          await switchModel(arg);
          break;
        }

        default:
          renderer.warn(`Neznámy príkaz /${cmd}. /help vypíše, čo poznám.`);
      }
    } catch (error) {
      report(error);
    }

    return 'ok';
  }

  /**
   * Prepnutie modelu.
   *
   * Ukladá sa aj do vlákna (PATCH), nie len do premennej klienta: to isté vlákno
   * otvorí aj web a keby model žil len tu, tá istá konverzácia by pokračovala na
   * inom modeli podľa toho, kto ju otvoril.
   */
  async function switchModel(id) {
    const payload = await client.get('/api/console/cli/models');
    const found = (payload?.models ?? []).find((m) => m.id === id || m.label === id);

    if (found === undefined) {
      renderer.warn(`Model „${id}" v ponuke nie je. /models vypíše, čo tam je.`);

      return;
    }

    current = await client.json(`/api/console/cli/threads/${current.uuid}`, {
      method: 'PATCH',
      body: { provider: found.provider, model: found.id },
    });

    chosenModel = current.model ?? found.id;
    chosenProvider = current.provider ?? found.provider;
    renderer.hint(`model ${chosenModel} (${chosenProvider})`);
  }

  /** Chyba sa vypíše tak, aby sa dalo konať — a nikdy s hlavičkami. */
  function report(error) {
    if (error instanceof HadesHttpError) {
      renderer.fail(describeHttpError(error, cfg));

      return;
    }

    const [first, ...rest] = describeNetworkError(error, cfg);
    renderer.fail(first);
    for (const line of rest) renderer.hint(line);
  }
}

export function prompt(color) {
  return color ? '\u001b[36mhades\u001b[0m \u001b[2m›\u001b[0m ' : 'hades > ';
}
