// Príkazy klienta ako PROCES — vrátane toho, čo skutočne skončí na stdout a
// aký je exit kód. Volanie `main()` v procese testu by tú hranicu nezmeralo:
// „na stdout je iba JSON" je vlastnosť procesu, nie funkcie.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { frames, sendChunks, sendJson, startStub } from './support/stub.mjs';

const CLIENT = fileURLToPath(new URL('../hades.mjs', import.meta.url));
const THREAD = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const HEADLESS_RESULT = {
  thread: THREAD,
  text: 'V sieti je 1065 uzlov.',
  tools: [{ name: 'mind_overview', status: 'done', duration_ms: 12 }],
  tokens_in: 812,
  tokens_out: 24,
  tokens_per_second: 9.31,
  stop_reason: 'stop',
  steps: 2,
};

/**
 * Spustí klienta ako proces.
 *
 * `cwd` je dočasný priečinok: bez toho by klient stúpal nahor a našel `.env`
 * tohto repa, takže test by závisel od stroja, na ktorom beží.
 */
function run(args, { url, token = 'stub-token' } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLIENT, ...args], {
      cwd: mkdtempSync(join(tmpdir(), 'hades-cli-')),
      env: {
        ...process.env,
        HADES_URL: url,
        HADES_UI_TOKEN: token,
        // Farby by do stdout primiešali escape sekvencie a `JSON.parse` by padol
        // na výstupe, ktorý je inak správny.
        NO_COLOR: '1',
      },
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

test('run --json vypíše na stdout IBA JSON', async () => {
  const stub = await startStub({
    'POST /api/console/headless': ({ res, body }) => {
      assert.equal(body.message, 'koľko je uzlov?');
      assert.equal('thread' in body, false, 'bez --thread sa vlákno neposiela');
      sendJson(res, 200, HEADLESS_RESULT);
    },
  });

  try {
    const { code, stdout, stderr } = await run(['run', 'koľko je uzlov?', '--json'], { url: stub.url });

    assert.equal(code, 0, `stderr: ${stderr}`);
    // Toto je celý zmysel režimu: `hades run … --json | jq` musí fungovať.
    const parsed = JSON.parse(stdout);
    assert.deepEqual(parsed, HEADLESS_RESULT);
    assert.equal(stderr, '', 'v tomto režime nemá klient čo písať na stderr');
  } finally {
    await stub.close();
  }
});

test('run --json --thread pošle vlákno a model', async () => {
  const stub = await startStub({
    'POST /api/console/headless': ({ res, body }) => {
      assert.deepEqual(body, { message: 'ahoj', thread: THREAD, model: 'qwen3-coder:30b' });
      sendJson(res, 200, HEADLESS_RESULT);
    },
  });

  try {
    const { code, stdout } = await run(
      ['run', 'ahoj', '--json', '--thread', THREAD, '--model', 'qwen3-coder:30b'],
      { url: stub.url },
    );

    assert.equal(code, 0);
    assert.equal(JSON.parse(stdout).thread, THREAD);
  } finally {
    await stub.close();
  }
});

test('HTTP 422 z headless skončí nenulovým exit kódom', async () => {
  const stub = await startStub({
    'POST /api/console/headless': ({ res }) => sendJson(res, 422, {
      thread: THREAD,
      error: 'Vlákno čaká na rozhodnutie o zápise. Rozhodni ho v konzole a spusti beh znova.',
    }),
  });

  try {
    const { code, stdout, stderr } = await run(['run', 'ahoj', '--json'], { url: stub.url });

    assert.notEqual(code, 0, 'ťah, ktorý neprebehol, nesmie skončiť nulou');
    assert.equal(stdout, '', 'pri chybe nesmie na stdout ostať nič — inak to `jq` zhltne ako výsledok');
    assert.match(stderr, /Vlákno čaká na rozhodnutie/);
  } finally {
    await stub.close();
  }
});

test('run (bez --json) dá text na stdout a kresbu na stderr', async () => {
  const stub = await startStub({
    'GET /api/console/cli/threads': ({ res }) => sendJson(res, 200, {
      threads: [{ uuid: THREAD, title: 'Posledné', model: 'qwen3:8b', last_message_at: new Date().toISOString() }],
    }),
    [`GET /api/console/cli/threads/${THREAD}`]: ({ res }) => sendJson(res, 200, {
      uuid: THREAD, title: 'Posledné', provider: 'ollama', model: 'qwen3:8b', messages: [], tool_calls: [],
    }),
    'POST /api/console/cli/run': ({ res, body }) => {
      assert.equal(body.thread, THREAD, 'bez --new sa pokračuje v poslednom vlákne');

      return sendChunks(res, frames(
        { t: 'start', message_id: 3, model: 'qwen3:8b', provider: 'ollama' },
        { t: 'tool', id: 9, call_id: 'c1', name: 'bash', arguments: { command: 'php artisan test' }, write: false },
        { t: 'tool_result', id: 9, status: 'done', result: 'Tests: 228 passed', duration_ms: 4200 },
        { t: 'delta', text: 'Testy prešli' },
        { t: 'delta', text: ', všetkých 228.' },
        { t: 'end', stop_reason: 'stop', tokens_in: 900, tokens_out: 12, tokens_per_second: 9.1 },
      ));
    },
  });

  try {
    const { code, stdout, stderr } = await run(['run', 'spusti testy'], { url: stub.url });

    assert.equal(code, 0, `stderr: ${stderr}`);
    // Text končí novým riadkom, aby `hades run … > odpoved.txt` dalo korektný
    // textový súbor. Nič iné na stdout nie je — karty toolov idú na stderr.
    assert.equal(stdout, 'Testy prešli, všetkých 228.\n');
    assert.match(stderr, /bash/);
    assert.match(stderr, /php artisan test/);
    assert.match(stderr, /hotovo/);
    assert.match(stderr, /4,2 s/);
    assert.match(stderr, /9\.1 tok\/s/);
  } finally {
    await stub.close();
  }
});

test('run bez terminálu na zaparkovanom zápise nekončí nulou', async () => {
  const stub = await startStub({
    'GET /api/console/cli/threads': ({ res }) => sendJson(res, 200, { threads: [] }),
    'POST /api/console/cli/threads': ({ res }) => sendJson(res, 201, {
      uuid: THREAD, title: 'Nové vlákno', provider: 'ollama', model: null, messages: [], tool_calls: [],
    }),
    'POST /api/console/cli/run': ({ res }) => sendChunks(res, frames(
      { t: 'start', message_id: 4 },
      { t: 'permission', id: 55, name: 'write_file', arguments: { path: 'app/X.php' }, preview: '+ nový riadok' },
    )),
  });

  try {
    const { code, stderr } = await run(['run', 'zapíš to'], { url: stub.url });

    assert.notEqual(code, 0);
    assert.match(stderr, /povolenie na zápis/);
    assert.equal(stub.calls.some((c) => c.path === '/api/console/cli/decide'), false, 'bez človeka sa nesmie rozhodnúť samo');
  } finally {
    await stub.close();
  }
});

test('401 a 403 vysvetlia PREČO a nevypíšu hlavičky', async () => {
  const stub = await startStub({
    'GET /api/console/cli/models': ({ res }) => sendJson(res, 401, { message: 'Hades je zamknutý.' }),
    'GET /api/console/cli/threads': ({ res }) => sendJson(res, 403, {
      message: 'Programový beh konzoly nejde cez proxy ani cez tunel.',
    }),
  });

  try {
    const unauthorized = await run(['models'], { url: stub.url });
    assert.equal(unauthorized.code, 1);
    assert.match(unauthorized.stderr, /401/);
    assert.match(unauthorized.stderr, /HADES_UI_TOKEN/);
    assert.equal(unauthorized.stderr.includes('stub-token'), false, 'token sa nesmie objaviť v chybe');
    assert.equal(/X-Hades-Ui-Token/i.test(unauthorized.stderr), false, 'hlavičky sa nevypisujú');

    const forbidden = await run(['threads'], { url: stub.url });
    assert.equal(forbidden.code, 1);
    assert.match(forbidden.stderr, /loopback/i);
    assert.match(forbidden.stderr, /proxy|tunel/i);
  } finally {
    await stub.close();
  }
});

test('threads a models vypíšu zoznam, models aj dôvod nedostupnosti', async () => {
  const stub = await startStub({
    'GET /api/console/cli/threads': ({ res }) => sendJson(res, 200, {
      threads: [
        { uuid: THREAD, title: 'Konzola', model: 'qwen3:8b', last_message_at: new Date(Date.now() - 7200_000).toISOString() },
        { uuid: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff', title: 'Graf', model: null, last_message_at: null },
      ],
    }),
    'GET /api/console/cli/models': ({ res }) => sendJson(res, 200, {
      models: [
        { id: 'qwen3:8b', label: 'qwen3:8b', provider: 'ollama' },
        { id: 'qwen3-coder:30b', label: 'qwen3-coder:30b', provider: 'ollama' },
      ],
      default: { provider: 'ollama', model: 'qwen3:8b' },
      unavailable: ['anthropic'],
    }),
  });

  try {
    const threads = await run(['threads'], { url: stub.url });
    assert.equal(threads.code, 0);
    assert.match(threads.stdout, new RegExp(THREAD));
    assert.match(threads.stdout, /Konzola/);
    assert.match(threads.stdout, /pred 2 h/);
    assert.match(threads.stdout, /bez správ/);

    const models = await run(['models'], { url: stub.url });
    assert.equal(models.code, 0);
    assert.match(models.stdout, /qwen3-coder:30b/);
    assert.match(models.stdout, /default/);
    assert.match(models.stdout, /anthropic/);
    assert.match(models.stdout, /ANTHROPIC_API_KEY/, 'nedostupnosť má mať dôvod, nie len meno');
  } finally {
    await stub.close();
  }
});

test('--help a --version idú na stdout a končia nulou; neznámy prepínač nie', async () => {
  const help = await run(['--help'], { url: 'http://127.0.0.1:1' });
  assert.equal(help.code, 0);
  assert.match(help.stdout, /hades run "<otázka>" --json/);

  const version = await run(['--version'], { url: 'http://127.0.0.1:1' });
  assert.equal(version.code, 0);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);

  const bad = await run(['--rozbi-to'], { url: 'http://127.0.0.1:1' });
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /Neznámy prepínač/);
});

test('nedostupný server skončí vetou, nie tracebackom', async () => {
  // Port 1 na loopbacku nikto neposlúcha — spojenie sa odmietne okamžite.
  const { code, stderr } = await run(['models'], { url: 'http://127.0.0.1:1' });

  assert.equal(code, 1);
  assert.match(stderr, /Nepodarilo sa spojiť/);
  assert.match(stderr, /Beží appka/);
  assert.equal(stderr.includes('at async'), false, 'toto nemá byť stack trace');
});
