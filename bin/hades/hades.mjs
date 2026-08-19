#!/usr/bin/env node
// -----------------------------------------------------------------------------
// `hades` — terminálový klient konzoly vedomia.
//
// Bez jedinej npm závislosti a bez `package.json`: klient má fungovať hneď po
// `git clone`, aj na stroji, kde `npm install` nikto nespustil. Všetko potrebné
// je v Node (`node:http` cez globálny `fetch`, `node:readline`, `node:fs`).
//
// Klient NEZDVOJUJE logiku konzoly. Hovorí s tým istým `/api/console/*` ako web,
// takže vlákno rozpísané v prehliadači sa dá dokončiť v termináli a naopak.
//
// Výstupný kontrakt, na ktorý sa dá skriptovať:
//   • text odpovede ide na stdout, kresba (karty toolov, čísla, chyby) na stderr,
//   • `run --json` má na stdout IBA JSON, takže `hades run … --json | jq` funguje,
//   • exit 0 = ťah dobehol, 1 = chyba behu alebo spojenia, 2 = chýba konfigurácia.
//
// Prerušený prúd (bez `end` aj bez `error`) je nenulový exit. Ťah, ktorý
// nedobehol, nesmie vyzerať ako úspešný — na to sa v skriptoch spoliehať nedá.
// -----------------------------------------------------------------------------

import {
  HadesHttpError,
  TURN_END,
  createClient,
  driveTurn,
  resolveThread,
} from './lib/api.mjs';
import { pathToFileURL } from 'node:url';

import { resolveConfig, setupHint } from './lib/config.mjs';
import { createRenderer, describeHttpError, describeNetworkError } from './lib/render.mjs';
import { startRepl } from './lib/repl.mjs';

const VERSION = '1.0.0';

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_NO_CONFIG = 2;

const USAGE = `hades ${VERSION} — konzola vedomia Hades v termináli

  hades                          interaktívny režim (pokračuje v poslednom vlákne)
  hades --new                    interaktívny režim v novom vlákne
  hades run "<otázka>"           jeden ťah, text ide na stdout
  hades run "<otázka>" --json    jeden ťah bez interakcie, na stdout čistý JSON
  hades threads                  zoznam vlákien
  hades models                   modely a čo je nedostupné
  hades doctor                   odkiaľ má adresu a token (token sa nevypisuje)

Prepínače:
  --thread <uuid>   konkrétne vlákno
  --new             založ nové vlákno
  --model <id>      model pre tento beh
  --help, --version

Konfigurácia sa hľadá v tomto poradí (prvý, kto ju má, vyhrá):
  1. HADES_URL / HADES_UI_TOKEN v prostredí
  2. ~/.hades/config.json  {"url": "…", "token": "…"}
  3. .env projektu — hľadá sa stúpaním nahor po priečinok s \`artisan\` a \`.env\`

Programový okruh konzoly je LOOPBACK-ONLY a nesmie ísť cez proxy ani tunel.`;

/**
 * Rozobratie argumentov.
 *
 * Vlastný parser a nie knižnica: kvôli jednému `--json` sa nemá pridávať
 * závislosť, ktorá klientovi zoberie vlastnosť „funguje po clone".
 *
 * @param {string[]} argv
 */
export function parseArgv(argv) {
  const flags = { json: false, fresh: false, thread: null, model: null, help: false, version: false };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--json') flags.json = true;
    else if (arg === '--new') flags.fresh = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--version' || arg === '-V') flags.version = true;
    else if (arg === '--thread') flags.thread = argv[i += 1] ?? null;
    else if (arg.startsWith('--thread=')) flags.thread = arg.slice('--thread='.length);
    else if (arg === '--model') flags.model = argv[i += 1] ?? null;
    else if (arg.startsWith('--model=')) flags.model = arg.slice('--model='.length);
    else if (arg.startsWith('-')) return { error: `Neznámy prepínač ${arg}. \`hades --help\` vypíše, čo poznám.` };
    else positional.push(arg);
  }

  return { command: positional.shift() ?? null, rest: positional, flags };
}

/**
 * @param {string[]} argv
 * @param {{env?: Record<string, string|undefined>, out?: NodeJS.WriteStream, err?: NodeJS.WriteStream, cwd?: string, home?: string}} [io]
 * @returns {Promise<number>} exit kód
 */
export async function main(argv = process.argv.slice(2), io = {}) {
  const out = io.out ?? process.stdout;
  const err = io.err ?? process.stderr;

  const parsed = parseArgv(argv);

  if (parsed.error !== undefined) {
    err.write(parsed.error + '\n');

    return EXIT_FAIL;
  }

  const { command, rest, flags } = parsed;

  if (flags.help || command === 'help') {
    out.write(USAGE + '\n');

    return EXIT_OK;
  }

  if (flags.version || command === 'version') {
    out.write(VERSION + '\n');

    return EXIT_OK;
  }

  const cfg = resolveConfig({ env: io.env ?? process.env, cwd: io.cwd, home: io.home });

  // `doctor` musí odpovedať aj (najmä!) keď token chýba — je to nástroj na to,
  // aby človek zistil prečo, nie ďalšie miesto, kde to zhavaruje.
  if (command === 'doctor') return doctor({ cfg, out, err });

  if (cfg.token === null) {
    err.write(setupHint(cfg) + '\n');

    return EXIT_NO_CONFIG;
  }

  const client = createClient({ url: cfg.url, token: cfg.token });

  try {
    switch (command) {
      case null:
        return await interactive({ client, cfg, flags, out, err });

      case 'run':
        return await runOnce({ client, cfg, flags, message: rest.join(' '), out, err });

      case 'threads': {
        const renderer = createRenderer({ out, err: out });
        const list = await client.get('/api/console/cli/threads');
        renderer.threadList(list?.threads, flags.thread);

        return EXIT_OK;
      }

      case 'models': {
        const renderer = createRenderer({ out, err: out });
        renderer.modelList(await client.get('/api/console/cli/models'));

        return EXIT_OK;
      }

      default:
        err.write(`Neznámy príkaz „${command}". \`hades --help\` vypíše, čo poznám.\n`);

        return EXIT_FAIL;
    }
  } catch (error) {
    return fail(error, { cfg, err });
  }
}

/** Interaktívny režim. */
async function interactive({ client, cfg, flags, out, err }) {
  if (!process.stdin.isTTY) {
    err.write('Interaktívny režim potrebuje terminál. Pre skript použi `hades run "…" --json`.\n');

    return EXIT_FAIL;
  }

  const renderer = createRenderer({ out, err: out });
  const thread = await resolveThread(client, { thread: flags.thread, fresh: flags.fresh, model: flags.model });

  if (!cfg.loopback) {
    renderer.warn(`Adresa ${cfg.url} nie je loopback. Programový okruh konzoly ju odmietne (403).`);
  }

  return startRepl({ client, renderer, cfg, thread, model: flags.model });
}

/** Jeden ťah — streamovaný, alebo headless s JSON výstupom. */
async function runOnce({ client, cfg, flags, message, out, err }) {
  if (message.trim() === '') {
    err.write('Chýba otázka: hades run "…"\n');

    return EXIT_FAIL;
  }

  if (flags.json) return runHeadless({ client, flags, message, out, err });

  // Text na stdout, kresba na stderr — aby `hades run … > odpoved.txt` uložilo
  // odpoveď a nie aj karty toolov.
  const renderer = createRenderer({ out, err });
  const thread = await resolveThread(client, { thread: flags.thread, fresh: flags.fresh, model: flags.model });

  const result = await driveTurn({
    client,
    body: { thread: thread.uuid, message, model: flags.model ?? thread.model ?? null },
    onFrame: (frame) => renderer.frame(frame),
    // Bez `onPermission`: v tomto režime nikto nesedí pri klávesnici a `deny`
    // naslepo by rozhodol za používateľa. `driveTurn` to ohlási ako prerušené.
    onPermission: undefined,
  });

  renderer.turnResult(result);

  if (result.status !== TURN_END) {
    if (result.status === 'interrupted') {
      err.write('Ťah chce povolenie na zápis. Bez terminálu ho nemá kto dať — dokonči ho v `hades` alebo vo web konzole.\n');
    }

    return EXIT_FAIL;
  }

  return EXIT_OK;
}

/**
 * `run --json` — jedna JSON odpoveď z `/console/headless`.
 *
 * Na stdout ide IBA to JSON. Chyby, varovania a čokoľvek iné ide na stderr,
 * pretože inak sa výstup nedá dať do `jq` — a práve pre `jq` tento režim je.
 */
async function runHeadless({ client, flags, message, out, err }) {
  const body = { message };
  if (flags.thread) body.thread = flags.thread;
  if (flags.model) body.model = flags.model;

  try {
    const result = await client.post('/api/console/headless', body);
    out.write(JSON.stringify(result) + '\n');

    return EXIT_OK;
  } catch (error) {
    if (error instanceof HadesHttpError && error.status === 422) {
      // 422 je „ťah neprebehol" (HeadlessController). Nenulový exit je tu
      // podstatnejší než telo: skript sa rozhoduje podľa kódu.
      err.write(`Ťah neprebehol: ${error.serverMessage ?? 'server neposlal dôvod.'}\n`);

      return EXIT_FAIL;
    }

    throw error;
  }
}

/**
 * `doctor` — odkiaľ má klient adresu a token, a či server odpovedá.
 *
 * Hodnota tokenu sa NEVYPISUJE, ani skrátená. Prefix tajomstva v logu terminálu
 * je stále prefix tajomstva a doctor sa spúšťa práve vtedy, keď človek výstup
 * niekam kopíruje.
 */
async function doctor({ cfg, out, err }) {
  out.write(`hades ${VERSION}\n\n`);
  out.write(`adresa    ${cfg.url}\n`);
  out.write(`  zdroj   ${cfg.urlSource}\n`);
  out.write(`token     ${cfg.token === null ? 'NENAŠEL SOM HO' : 'našel som ho (hodnotu nevypisujem)'}\n`);
  out.write(`  zdroj   ${cfg.tokenSource ?? '—'}\n`);
  out.write(`projekt   ${cfg.projectRoot ?? 'nenašel som priečinok s `artisan` a `.env`'}\n`);
  out.write(`~/.hades  ${cfg.userConfigPath ?? 'nie je'}\n`);
  out.write(`loopback  ${cfg.loopback ? 'áno' : 'NIE — okruh konzoly to odmietne (403)'}\n\n`);

  if (cfg.token === null) {
    out.write(setupHint(cfg) + '\n');

    return EXIT_NO_CONFIG;
  }

  const client = createClient({ url: cfg.url, token: cfg.token });

  try {
    const models = await client.get('/api/console/cli/models');
    const count = Array.isArray(models?.models) ? models.models.length : 0;
    out.write(`server    odpovedá · ${count} ${plural(count, 'model', 'modely', 'modelov')} v ponuke\n`);

    return EXIT_OK;
  } catch (error) {
    out.write('server    NEODPOVEDÁ tak, ako má\n\n');

    return fail(error, { cfg, err });
  }
}

/**
 * Slovenský plurál: 1 model, 2–4 modely, 5+ modelov.
 *
 * Anglické „1 / ostatné" tu nestačí — „2 modelov" je viditeľne zlé a doctor je
 * výpis, ktorý človek číta pozorne.
 */
function plural(count, one, few, many) {
  if (count === 1) return one;

  return count >= 2 && count <= 4 ? few : many;
}

/** Jedno miesto, kde sa chyba prekladá na vetu a na exit kód. */
function fail(error, { cfg, err }) {
  if (error instanceof HadesHttpError) {
    err.write(describeHttpError(error, cfg) + '\n');

    return EXIT_FAIL;
  }

  for (const line of describeNetworkError(error, cfg)) err.write(line + '\n');

  return EXIT_FAIL;
}

// Spustenie ako program; pri importe (testy) sa nič nestane.
//
// `pathToFileURL` a nie ručne zlepené `file://…`: na Windows je cesta `C:\…`
// a ručná URL by sa s `import.meta.url` nikdy netrafila — klient by sa spustil
// a mlčky skončil bez toho, aby čokoľvek urobil.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
