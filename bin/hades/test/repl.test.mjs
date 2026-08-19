// Interaktívna smyčka nad podstrčeným stdin/stdout.
//
// Prečo takto a nie „to sa overí prekliknutím": práve tu žije jediné miesto, kde
// beh stojí a čaká na jedno stlačenie klávesu. Bez testu sa regresia prejaví tak,
// že sa ťah zasekne navždy — a to je presne ten druh chyby, ktorý si človek pri
// ručnom preklikaní vysvetlí ako „model asi ešte myslí".

import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';

import { createClient } from '../lib/api.mjs';
import { createRenderer } from '../lib/render.mjs';
import { startRepl } from '../lib/repl.mjs';
import { frames, sendChunks, sendJson, sleep, startStub } from './support/stub.mjs';

const THREAD = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OTHER = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';

const CFG = { url: 'http://127.0.0.1:0', tokenSource: 'test', loopback: true };

function threadPayload(uuid = THREAD, extra = {}) {
  return {
    uuid,
    title: 'Konzola',
    provider: 'ollama',
    model: 'qwen3:8b',
    messages: [],
    tool_calls: [],
    ...extra,
  };
}

/** Čaká na obsah, nie na fixný čas — inak je test flaky podľa zaťaženia stroja. */
async function waitFor(getText, pattern, label) {
  for (let i = 0; i < 400; i += 1) {
    if (pattern.test(getText())) return;
    await sleep(10);
  }

  throw new Error(`Vo výstupe som sa nedočkal ${label ?? pattern}. Výstup:\n${getText()}`);
}

/** REPL nad rúrkami namiesto terminálu. */
function harness(stubUrl, thread = threadPayload()) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let text = '';
  stdout.on('data', (chunk) => { text += chunk.toString('utf8'); });

  const client = createClient({ url: stubUrl, token: 'stub' });
  const renderer = createRenderer({ out: stdout, err: stdout, color: false });
  const done = startRepl({ client, renderer, cfg: CFG, thread, stdin, stdout });

  return { stdin, done, text: () => text };
}

test('ťah sa vypisuje priebežne, zápis sa potvrdí jedným klávesom a beh pokračuje', async () => {
  const stub = await startStub({
    'POST /api/console/cli/run': ({ res }) => sendChunks(res, frames(
      { t: 'start', message_id: 1, model: 'qwen3:8b', provider: 'ollama' },
      { t: 'delta', text: 'Pozriem sa na to. ' },
      { t: 'permission', id: 77, name: 'bash', arguments: { command: 'php artisan test' }, preview: 'php artisan test' },
    )),
    'POST /api/console/cli/decide': ({ res }) => sendChunks(res, frames(
      { t: 'tool', id: 77, call_id: 'c1', name: 'bash', arguments: { command: 'php artisan test' }, write: true },
      { t: 'tool_result', id: 77, status: 'done', result: 'Tests: 228 passed', duration_ms: 4200 },
      { t: 'delta', text: 'Testy prešli.' },
      { t: 'end', stop_reason: 'stop', tokens_in: 900, tokens_out: 20, tokens_per_second: 9.1 },
    )),
  });

  const h = harness(stub.url);

  try {
    h.stdin.write('spusti testy\n');

    await waitFor(h.text, /Pozriem sa na to/, 'priebežný text z rámcov delta');
    await waitFor(h.text, /Zápis čaká na povolenie/, 'otázku na povolenie');
    await waitFor(h.text, /len tento vzor príkazu/, 'zúženie povolenia pri bash');

    // Jedno stlačenie, žiadny Enter.
    h.stdin.write('p');

    await waitFor(h.text, /Tests: 228 passed/, 'výsledok toolu');
    await waitFor(h.text, /Testy prešli\./, 'dostreamovanú odpoveď');
    await waitFor(h.text, /9\.1 tok\/s/, 'čísla z rámca end');

    const decide = stub.calls.find((c) => c.path === '/api/console/cli/decide');
    assert.deepEqual(decide.body, { thread: THREAD, call: 77, decision: 'allow' });

    h.stdin.write('/exit\n');
    assert.equal(await h.done, 0);
  } finally {
    h.stdin.end();
    await stub.close();
  }
});

test('Esc pri otázke zamietne a ťah sa dokončí zamietnutím', async () => {
  const stub = await startStub({
    'POST /api/console/cli/run': ({ res }) => sendChunks(res, frames(
      { t: 'start', message_id: 2 },
      { t: 'permission', id: 78, name: 'write_file', arguments: { path: 'app/X.php' }, preview: '+ nový riadok' },
    )),
    'POST /api/console/cli/decide': ({ res }) => sendChunks(res, frames(
      { t: 'tool_result', id: 78, status: 'denied', result: 'Používateľ tento zápis zamietol.', duration_ms: 0 },
      { t: 'delta', text: 'Dobre.' },
      { t: 'end', stop_reason: 'stop', tokens_in: 10, tokens_out: 2 },
    )),
  });

  const h = harness(stub.url);

  try {
    h.stdin.write('zapíš to\n');
    await waitFor(h.text, /Zápis čaká na povolenie/, 'otázku na povolenie');

    // Presne to, čo pošle terminál: `readline` má na vstupe utf8 kódovanie,
    // takže kláves prichádza ako ZNAK, nie ako bajt.
    h.stdin.write('\u001b');

    await waitFor(h.text, /zamietnuté/, 'stav zamietnutia');
    const decide = stub.calls.find((c) => c.path === '/api/console/cli/decide');
    assert.equal(decide.body.decision, 'deny');

    h.stdin.write('/exit\n');
    assert.equal(await h.done, 0);
  } finally {
    h.stdin.end();
    await stub.close();
  }
});

test('slash príkazy: /threads, /thread, /models, /new, /help', async () => {
  const stub = await startStub({
    'GET /api/console/cli/threads': ({ res }) => sendJson(res, 200, {
      threads: [
        { uuid: THREAD, title: 'Konzola', model: 'qwen3:8b', last_message_at: new Date().toISOString() },
        { uuid: OTHER, title: 'Graf', model: null, last_message_at: null },
      ],
    }),
    [`GET /api/console/cli/threads/${OTHER}`]: ({ res }) => sendJson(res, 200, threadPayload(OTHER, { title: 'Graf' })),
    'POST /api/console/cli/threads': ({ res }) => sendJson(res, 201, threadPayload('cccccccc-dddd-eeee-ffff-000000000000', { title: 'Nové vlákno' })),
    'GET /api/console/cli/models': ({ res }) => sendJson(res, 200, {
      models: [{ id: 'qwen3:8b', label: 'qwen3:8b', provider: 'ollama' }],
      default: { provider: 'ollama', model: 'qwen3:8b' },
      unavailable: ['anthropic'],
    }),
  });

  const h = harness(stub.url);

  try {
    h.stdin.write('/help\n');
    await waitFor(h.text, /\/thread <uuid>/, 'výpis pomoci');

    h.stdin.write('/threads\n');
    await waitFor(h.text, new RegExp(OTHER), 'zoznam vlákien');

    h.stdin.write(`/thread ${OTHER}\n`);
    await waitFor(h.text, /Graf/, 'prepnuté vlákno');

    h.stdin.write('/models\n');
    await waitFor(h.text, /ANTHROPIC_API_KEY/, 'dôvod nedostupnosti');

    h.stdin.write('/new\n');
    await waitFor(h.text, /cccccccc-dddd-eeee-ffff-000000000000/, 'nové vlákno');

    h.stdin.write('/neexistuje\n');
    await waitFor(h.text, /Neznámy príkaz/, 'odmietnutie neznámeho príkazu');

    h.stdin.write('/exit\n');
    assert.equal(await h.done, 0);
  } finally {
    h.stdin.end();
    await stub.close();
  }
});

test('chyba servera uprostred smyčky ju nezhodí — dá sa písať ďalej', async () => {
  let attempt = 0;
  const stub = await startStub({
    'POST /api/console/cli/run': ({ res }) => {
      attempt += 1;

      if (attempt === 1) return sendJson(res, 500, { message: 'Beh spadol. Detail je v logu appky.' });

      return sendChunks(res, frames(
        { t: 'delta', text: 'druhý pokus prešiel' },
        { t: 'end', stop_reason: 'stop', tokens_in: 4, tokens_out: 4 },
      ));
    },
  });

  const h = harness(stub.url);

  try {
    h.stdin.write('prvá otázka\n');
    await waitFor(h.text, /HTTP 500/, 'vysvetlenie chyby');

    h.stdin.write('druhá otázka\n');
    await waitFor(h.text, /druhý pokus prešiel/, 'ďalší ťah po chybe');

    h.stdin.write('/exit\n');
    assert.equal(await h.done, 0);
  } finally {
    h.stdin.end();
    await stub.close();
  }
});


/** Stub s ťahom, ktorý trvá — aby sa dalo písať a prerušovať uprostred. */
async function slowStub(sent) {
  return startStub({
    'POST /api/console/cli/run': async ({ res, body }) => {
      sent.push(body.message);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(frames({ t: 'delta', text: `odpovedám na „${body.message}" ` }).join(''));

      // Prvý ťah je dlhý (je čas písať aj prerušiť), ďalšie dobehnú hneď.
      if (sent.length === 1) await sleep(500);

      if (!res.writableEnded && !res.destroyed) {
        res.write(frames({ t: 'end', stop_reason: 'stop', tokens_in: 5, tokens_out: 5 }).join(''));
        res.end();
      }
    },
  });
}

test('správa napísaná POČAS behu sa nestratí — použije sa na ďalšom prompte', async () => {
  const sent = [];
  const stub = await slowStub(sent);
  const h = harness(stub.url);

  try {
    h.stdin.write('prvá správa\n');
    await waitFor(h.text, /odpovedám na „prvá správa"/, 'prvý ťah');

    // Človek začne písať, kým model ešte hovorí. Toto je najčastejšia chvíľa,
    // kedy sa vstup dá stratiť — a stratiť sa nesmie.
    h.stdin.write('druhá správa\n');

    await waitFor(h.text, /odpovedám na „druhá správa"/, 'ťah z type-ahead');
    assert.deepEqual(sent, ['prvá správa', 'druhá správa']);

    h.stdin.write('/exit\n');
    assert.equal(await h.done, 0);
  } finally {
    h.stdin.end();
    await stub.close();
  }
});

test('Ctrl+C zastaví beh a klient žije ďalej; druhé Ctrl+C ho ukončí', async () => {
  const sent = [];
  const stub = await slowStub(sent);
  const h = harness(stub.url);

  try {
    h.stdin.write('dlhá otázka\n');
    await waitFor(h.text, /odpovedám na „dlhá otázka"/, 'začiatok odpovede');

    h.stdin.write('\u0003');
    await waitFor(h.text, /zastavujem beh/, 'oznámenie o zastavení');
    await waitFor(h.text, /beh zastavený/, 'výsledok ťahu');

    // To, čo pritieklo pred prerušením, zostáva na obrazovke.
    assert.match(h.text(), /odpovedám na „dlhá otázka"/);

    // Klient žije: ďalší ťah prejde.
    h.stdin.write('ešte raz\n');
    await waitFor(h.text, /odpovedám na „ešte raz"/, 'ďalší ťah po prerušení');

    h.stdin.write('\u0003');
    assert.equal(await h.done, 0, 'druhé Ctrl+C má ukončiť program');
  } finally {
    h.stdin.end();
    await stub.close();
  }
});
