// Parkovanie ťahu na povolenie zápisu: rámec `permission` → `/decide` →
// dostreamovanie toho istého ťahu. Overuje sa aj TELO requestu, nie len výpis —
// zle poslané `call` je chyba, ktorú na obrazovke nevidno.

import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';

import { TURN_END, createClient, driveTurn } from '../lib/api.mjs';
import { colorizeDiff, createRenderer } from '../lib/render.mjs';
import { askDecision, createKeyboard } from '../lib/repl.mjs';
import { frames, sendChunks, sink, startStub } from './support/stub.mjs';

const THREAD = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const PREVIEW = [
  '--- a/app/Example.php',
  '+++ b/app/Example.php',
  '@@ -1,3 +1,3 @@',
  ' nezmenený riadok',
  '-zmazaný riadok',
  '+pridaný riadok',
].join('\n');

/** Stub, ktorý ťah zaparkuje a po rozhodnutí ho dokončí podľa toho rozhodnutia. */
async function parkingStub() {
  return startStub({
    'POST /api/console/cli/run': ({ res }) => sendChunks(res, frames(
      { t: 'start', message_id: 7, model: 'qwen3:8b', provider: 'ollama' },
      { t: 'step', n: 1, of: 12 },
      { t: 'permission', id: 41, name: 'edit_file', arguments: { path: 'app/Example.php' }, preview: PREVIEW },
    )),

    'POST /api/console/cli/decide': ({ res, body }) => {
      const denied = body?.decision === 'deny';

      return sendChunks(res, frames(
        ...(denied
          ? [{ t: 'tool_result', id: 41, status: 'denied', result: 'Používateľ tento zápis zamietol.', duration_ms: 0 }]
          : [
            { t: 'tool', id: 41, call_id: 'call_1', name: 'edit_file', arguments: { path: 'app/Example.php' }, write: true },
            { t: 'tool_result', id: 41, status: 'done', result: 'Zapísané: app/Example.php', duration_ms: 34 },
          ]),
        { t: 'delta', text: denied ? 'Dobre, nechám to.' : 'Hotovo.' },
        { t: 'end', stop_reason: 'stop', tokens_in: 120, tokens_out: 9, tokens_per_second: 8.7 },
      ));
    },
  });
}

test('rámec permission vedie na /decide s očakávaným telom a beh sa dostreamuje', async () => {
  const stub = await parkingStub();

  try {
    const client = createClient({ url: stub.url, token: 'stub' });
    const out = sink();
    const renderer = createRenderer({ out, err: out, color: false });
    let asked = null;

    const result = await driveTurn({
      client,
      body: { thread: THREAD, message: 'uprav ten súbor' },
      onFrame: (frame) => renderer.frame(frame),
      onPermission: (frame) => { asked = frame; renderer.permission(frame); return 'allow'; },
    });

    assert.equal(result.status, TURN_END);
    assert.deepEqual(result.decisions, ['allow']);
    assert.equal(asked?.name, 'edit_file');

    const decide = stub.calls.find((c) => c.path === '/api/console/cli/decide');
    assert.ok(decide !== undefined, '/decide sa nezavolalo');
    assert.deepEqual(decide.body, { thread: THREAD, call: 41, decision: 'allow' });
    assert.ok(decide.hasToken, 'aj /decide musí niesť token');

    // Ťah pokračoval: po rozhodnutí prišli tooly aj text.
    assert.match(out.text, /Zapísané: app\/Example\.php/);
    assert.match(out.text, /hotovo/);
    assert.match(out.text, /Hotovo\./);
  } finally {
    await stub.close();
  }
});

test('deny pošle decision deny a klient to oznámi', async () => {
  const stub = await parkingStub();

  try {
    const client = createClient({ url: stub.url, token: 'stub' });
    const out = sink();
    const renderer = createRenderer({ out, err: out, color: false });

    const result = await driveTurn({
      client,
      body: { thread: THREAD, message: 'uprav ten súbor' },
      onFrame: (frame) => renderer.frame(frame),
      onPermission: () => 'deny',
    });

    assert.equal(result.status, TURN_END);

    const decide = stub.calls.find((c) => c.path === '/api/console/cli/decide');
    assert.deepEqual(decide.body, { thread: THREAD, call: 41, decision: 'deny' });

    assert.match(out.text, /zamietnuté/);
    assert.match(out.text, /Dobre, nechám to\./);
  } finally {
    await stub.close();
  }
});

test('bez rozhodovača je zaparkovaný ťah prerušený, nie tichý deny', async () => {
  const stub = await parkingStub();

  try {
    const client = createClient({ url: stub.url, token: 'stub' });

    const result = await driveTurn({
      client,
      body: { thread: THREAD, message: 'uprav ten súbor' },
      onPermission: undefined,
    });

    assert.equal(result.status, 'interrupted');
    assert.equal(stub.calls.some((c) => c.path === '/api/console/cli/decide'), false);
  } finally {
    await stub.close();
  }
});

test('jedno stlačenie klávesu → rozhodnutie; Esc zamieta', async () => {
  // PassThrough namiesto skutočného stdin: test nesmie závisieť od terminálu, ale
  // musí to byť SKUTOČNÝ stream — klávesnica si vstup preberá (`resume`/`pause`).
  // Klávesy sa doručujú `emit('data', Buffer)`, teda BAJTMI: skutočný terminál
  // pošle po `readline` reťazce a tento test kryje druhú vetvu normalizácie
  // (`repl.test.mjs` kryje tú reťazcovú).
  const stdin = new PassThrough();
  const keyboard = createKeyboard({ stdin });
  const out = sink();
  const renderer = createRenderer({ out, err: out, color: false });
  const disarm = keyboard.arm(() => {});

  const cases = [
    [Buffer.from('p'), 'allow'],
    [Buffer.from('v'), 'allow_always'],
    [Buffer.from('z'), 'deny'],
    [Buffer.from([27]), 'deny'],
  ];

  for (const [key, expected] of cases) {
    const pending = askDecision(keyboard, renderer, { name: 'bash', arguments: { command: 'php artisan test' } });
    // Kláves musí prísť až po tom, čo si `askDecision` zaregistruje čakanie.
    await new Promise((resolve) => setImmediate(resolve));
    stdin.emit('data', key);

    assert.equal(await pending, expected, `kláves ${JSON.stringify(key.toString('latin1'))}`);
  }

  disarm();

  // Pri `bash` musí „vždy" priznať, že sa týka len tohto vzoru príkazu —
  // backend povolenie zúži (NarrowsAllowance) a klient to nesmie zamlčať.
  assert.match(out.text, /len tento vzor príkazu/);
});

test('diff v náhľade sa farbí: + zeleno, - červeno, hlavičky nie', () => {
  const painted = colorizeDiff(PREVIEW, true);
  const lines = painted.split('\n');

  assert.ok(lines[0].startsWith('\u001b[2m'), 'hlavička --- nesmie byť červená');
  assert.ok(lines[1].startsWith('\u001b[2m'), 'hlavička +++ nesmie byť zelená');
  assert.ok(lines[2].startsWith('\u001b[36m'), '@@ má byť odlíšené');
  assert.ok(lines[4].startsWith('\u001b[31m'), 'zmazaný riadok má byť červený');
  assert.ok(lines[5].startsWith('\u001b[32m'), 'pridaný riadok má byť zelený');

  assert.equal(colorizeDiff(PREVIEW, false).includes('\u001b'), false, 'bez farieb žiadne escape kódy');
});
