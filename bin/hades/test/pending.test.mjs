// Front odložených zápisov (`hades pending`) — ako PROCES.
//
// Prečo proces a nie `main()` v teste: dve z overovaných vlastností sú vlastnosti
// procesu, nie funkcie — „na stdout je iba JSON" a „nenulový exit kód". Presne to
// isté delenie ako v `cli.test.mjs`.
//
// Stub si pamätá volania, takže sa dá overiť aj to, čo klient POSLAL: pri
// rozhodovaní je cesta requestu (`/pending/<id>/approve`) to podstatné — z výpisu
// na obrazovke sa nedá zistiť, či klient netrafil iný endpoint.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { sendJson, startStub } from './support/stub.mjs';

const CLIENT = fileURLToPath(new URL('../hades.mjs', import.meta.url));
const THREAD = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const FIRST = '11111111-2222-3333-4444-555555555555';
const SECOND = '66666666-7777-8888-9999-aaaaaaaaaaaa';

const QUEUE = {
  proposals: [
    {
      id: FIRST,
      thread: THREAD,
      name: 'write_file',
      arguments: { path: 'app/Services/Foo.php', content: 'x' },
      preview: '--- a/app/Services/Foo.php\n+++ b/app/Services/Foo.php\n@@ -1,2 +1,2 @@\n-starý\n+TRETÍ\n',
      status: 'pending',
      created_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    },
    {
      id: SECOND,
      thread: THREAD,
      name: 'mind_learn',
      arguments: { label: 'Klietka pre bash' },
      preview: 'nový uzol: Klietka pre bash',
      status: 'pending',
      created_at: new Date().toISOString(),
    },
  ],
  total: 2,
};

/**
 * Spustí klienta ako proces.
 *
 * `cwd` je dočasný priečinok: inak by klient stúpal nahor, našel `.env` tohto
 * repa a test by závisel od stroja, na ktorom beží.
 */
function run(args, { url, token = 'stub-token' } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLIENT, ...args], {
      cwd: mkdtempSync(join(tmpdir(), 'hades-pending-')),
      env: { ...process.env, HADES_URL: url, HADES_UI_TOKEN: token, NO_COLOR: '1' },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('prázdny front nie je chyba a povie, odkiaľ by sa návrhy vzali', async () => {
  const stub = await startStub({
    'GET /api/console/cli/pending': ({ res }) => sendJson(res, 200, { proposals: [], total: 0 }),
  });

  try {
    const { code, stdout, stderr } = await run(['pending'], { url: stub.url });

    assert.equal(code, 0, `stderr: ${stderr}`);
    assert.match(stdout, /Front je prázdny/);
    // bez tejto vety vyzerá prázdny výpis ako pokazený príkaz
    assert.match(stdout, /nočný rozvrh/);
  } finally {
    await stub.close();
  }
});

test('front vypíše id, tool, argument aj diff', async () => {
  const stub = await startStub({
    'GET /api/console/cli/pending': ({ res }) => sendJson(res, 200, QUEUE),
  });

  try {
    const { code, stdout, stderr } = await run(['pending'], { url: stub.url });

    assert.equal(code, 0, `stderr: ${stderr}`);
    assert.match(stdout, /2 čakajú/);

    // id musí byť vo výpise celé — je to jediné, čím sa dá rozhodnúť
    assert.ok(stdout.includes(FIRST), 'chýba id prvého návrhu');
    assert.ok(stdout.includes(SECOND), 'chýba id druhého návrhu');

    assert.match(stdout, /write_file\s+app\/Services\/Foo\.php/);
    assert.match(stdout, /mind_learn/);
    assert.match(stdout, /\+TRETÍ/, 'bez diffu sa o zápise nedá rozhodnúť');
    assert.match(stdout, /pred 3 h/);
    assert.match(stdout, /hades pending approve <id>/);
  } finally {
    await stub.close();
  }
});

test('pending --json vypíše na stdout IBA JSON', async () => {
  const stub = await startStub({
    'GET /api/console/cli/pending': ({ res }) => sendJson(res, 200, QUEUE),
  });

  try {
    const { code, stdout, stderr } = await run(['pending', '--json'], { url: stub.url });

    assert.equal(code, 0, `stderr: ${stderr}`);
    assert.deepEqual(JSON.parse(stdout), QUEUE);
    assert.equal(stderr, '', 'v tomto režime nemá klient čo písať na stderr');
  } finally {
    await stub.close();
  }
});

test('--thread zúži front na jedno vlákno (query, nie iná routa)', async () => {
  const stub = await startStub({
    'GET /api/console/cli/pending': ({ req, res }) => {
      const url = new URL(req.url, 'http://stub');
      assert.equal(url.searchParams.get('thread'), THREAD);
      sendJson(res, 200, { proposals: [], total: 0 });
    },
  });

  try {
    const { code } = await run(['pending', '--thread', THREAD], { url: stub.url });

    assert.equal(code, 0);
  } finally {
    await stub.close();
  }
});

test('approve pošle POST na cestu návrhu a vypíše, čo vrátil server', async () => {
  const stub = await startStub({
    [`POST /api/console/cli/pending/${FIRST}/approve`]: ({ res }) => sendJson(res, 200, {
      proposal: {
        id: FIRST,
        name: 'write_file',
        arguments: { path: 'app/Services/Foo.php' },
        status: 'approved',
        result: 'Overwrote app/Services/Foo.php (2 lines, 14 bytes).',
      },
    }),
  });

  try {
    const { code, stdout, stderr } = await run(['pending', 'approve', FIRST], { url: stub.url });

    assert.equal(code, 0, `stderr: ${stderr}`);
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].method, 'POST');
    assert.equal(stub.calls[0].path, `/api/console/cli/pending/${FIRST}/approve`);
    assert.equal(stub.calls[0].hasToken, true);

    assert.match(stdout, /Povolené · write_file/);
    assert.match(stdout, /Overwrote app\/Services\/Foo\.php/);
  } finally {
    await stub.close();
  }
});

test('deny pošle POST na svoju cestu', async () => {
  const stub = await startStub({
    [`POST /api/console/cli/pending/${SECOND}/deny`]: ({ res }) => sendJson(res, 200, {
      proposal: { id: SECOND, name: 'mind_learn', status: 'denied', result: 'Zamietnuté človekom — tool sa nevykonal.' },
    }),
  });

  try {
    const { code, stdout } = await run(['pending', 'deny', SECOND], { url: stub.url });

    assert.equal(code, 0);
    assert.equal(stub.calls[0].path, `/api/console/cli/pending/${SECOND}/deny`);
    assert.match(stdout, /Zamietnuté · mind_learn/);
  } finally {
    await stub.close();
  }
});

/**
 * Idempotencia frontu sa musí prejaviť aj na obrazovke: keď server vráti stav
 * `denied` na `approve`, klient NESMIE napísať „povolené" — inak človek uverí,
 * že sa práve niečo vykonalo.
 */
test('approve nad už zamietnutým návrhom sa nevydáva za povolenie', async () => {
  const stub = await startStub({
    [`POST /api/console/cli/pending/${FIRST}/approve`]: ({ res }) => sendJson(res, 200, {
      proposal: { id: FIRST, name: 'write_file', status: 'denied', result: 'Zamietnuté človekom — tool sa nevykonal.' },
    }),
  });

  try {
    const { code, stdout } = await run(['pending', 'approve', FIRST], { url: stub.url });

    assert.equal(code, 0);
    assert.doesNotMatch(stdout, /^Povolené/m);
    assert.match(stdout, /bol už predtým zamietnutý/);
  } finally {
    await stub.close();
  }
});

test('neznámy podpríkaz je nenulový exit a chyba na stderr', async () => {
  const stub = await startStub({
    'GET /api/console/cli/pending': ({ res }) => sendJson(res, 200, QUEUE),
  });

  try {
    const { code, stdout, stderr } = await run(['pending', 'schvalit', FIRST], { url: stub.url });

    assert.notEqual(code, 0);
    assert.equal(stdout, '', 'pri chybe nesmie na stdout ostať nič');
    assert.match(stderr, /Neznámy podpríkaz/);
    assert.equal(stub.calls.length, 0, 'zlý podpríkaz sa nesmie poslať na server');
  } finally {
    await stub.close();
  }
});

test('approve bez id neposlal nič a skončil chybou', async () => {
  const stub = await startStub({
    'GET /api/console/cli/pending': ({ res }) => sendJson(res, 200, QUEUE),
  });

  try {
    const { code, stderr } = await run(['pending', 'approve'], { url: stub.url });

    assert.notEqual(code, 0);
    assert.match(stderr, /Chýba id návrhu/);
    assert.equal(stub.calls.length, 0);
  } finally {
    await stub.close();
  }
});

test('404 pri rozhodovaní vysvetlí obe príčiny a nie je pád', async () => {
  const stub = await startStub({
    [`POST /api/console/cli/pending/${FIRST}/approve`]: ({ res }) => sendJson(res, 404, {
      message: 'No query results for model [App\\Models\\ConsoleWriteProposal].',
    }),
  });

  try {
    const { code, stdout, stderr } = await run(['pending', 'approve', FIRST], { url: stub.url });

    assert.notEqual(code, 0);
    assert.equal(stdout, '');
    assert.match(stderr, new RegExp(FIRST));
    assert.match(stderr, /vetva bez frontu návrhov/);
  } finally {
    await stub.close();
  }
});
