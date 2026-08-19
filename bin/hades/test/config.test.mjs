// Poradie zdrojov konfigurácie a mlčanlivosť `doctor`.
//
// Poradie sa testuje na dočasnom strome (`artisan` + `.env` + `~/.hades`), nie
// na skutočnom domove a repe: test, ktorý číta ozajstný `.env`, by prešiel aj s
// pokazeným poradím — hodnota by sa našla „nejako".

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { DEFAULT_URL, findProjectRoot, parseEnvFile, resolveConfig } from '../lib/config.mjs';
import { main } from '../hades.mjs';
import { sink, startStub } from './support/stub.mjs';

const ENV_TOKEN = 'token-z-prostredia-AAA';
const HOME_TOKEN = 'token-z-domoveho-configu-BBB';
const DOTENV_TOKEN = 'token-z-env-projektu-CCC';

/** Dočasný „projekt" + dočasný domov, aby test nesiahal na skutočné súbory. */
function fixture({ withHomeConfig = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hades-cfg-'));
  const project = join(root, 'projekt');
  const deep = join(project, 'app', 'Services');
  const home = join(root, 'domov');

  mkdirSync(deep, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(project, 'artisan'), '#!/usr/bin/env php\n');
  writeFileSync(
    join(project, '.env'),
    `APP_URL=http://localhost:8080\nHADES_UI_TOKEN=${DOTENV_TOKEN}\n# komentár\n`,
  );

  if (withHomeConfig) {
    mkdirSync(join(home, '.hades'), { recursive: true });
    writeFileSync(
      join(home, '.hades', 'config.json'),
      JSON.stringify({ url: 'http://127.0.0.1:9999', token: HOME_TOKEN }),
    );
  }

  return { root, project, deep, home };
}

test('prostredie vyhrá nad ~/.hades aj nad .env projektu', () => {
  const f = fixture();
  const cfg = resolveConfig({
    env: { HADES_URL: 'http://127.0.0.1:8123', HADES_UI_TOKEN: ENV_TOKEN },
    home: f.home,
    cwd: f.deep,
  });

  assert.equal(cfg.token, ENV_TOKEN);
  assert.equal(cfg.url, 'http://127.0.0.1:8123');
  assert.match(cfg.tokenSource, /HADES_UI_TOKEN/);
  assert.match(cfg.tokenSource, /prostredia/);
});

test('~/.hades/config.json vyhrá nad .env projektu', () => {
  const f = fixture();
  const cfg = resolveConfig({ env: {}, home: f.home, cwd: f.deep });

  assert.equal(cfg.token, HOME_TOKEN);
  assert.equal(cfg.url, 'http://127.0.0.1:9999');
  assert.match(cfg.tokenSource, /config\.json/);
});

test('.env projektu je posledný zdroj — a nájde sa stúpaním nahor', () => {
  const f = fixture({ withHomeConfig: false });
  const cfg = resolveConfig({ env: {}, home: f.home, cwd: f.deep });

  assert.equal(cfg.token, DOTENV_TOKEN);
  assert.equal(cfg.url, 'http://localhost:8080');
  assert.match(cfg.tokenSource, /\.env/);
  assert.equal(cfg.projectRoot, f.project);
  assert.equal(cfg.loopback, true);
});

test('bez akéhokoľvek zdroja nie je token a adresa padne na default', () => {
  const f = fixture({ withHomeConfig: false });
  const cfg = resolveConfig({ env: {}, home: f.home, cwd: f.root });

  assert.equal(cfg.token, null);
  assert.equal(cfg.tokenSource, null);
  assert.equal(cfg.url, DEFAULT_URL);
  assert.equal(cfg.projectRoot, null);
});

test('projekt je priečinok s `artisan` AJ `.env`, nie s jedným z nich', () => {
  const root = mkdtempSync(join(tmpdir(), 'hades-cfg-'));
  const onlyEnv = join(root, 'cudzi-projekt');
  mkdirSync(onlyEnv, { recursive: true });
  writeFileSync(join(onlyEnv, '.env'), 'HADES_UI_TOKEN=cudzi\n');

  assert.equal(findProjectRoot(onlyEnv), null);
});

test('parseEnvFile: úvodzovky sa strhnú, `#` v hodnote prežije', () => {
  const parsed = parseEnvFile([
    '# celý riadok je komentár',
    'A="v úvodzovkách"',
    "B='v apostrofoch'",
    'C=ha#sh',
    'D=hodnota # a komentár',
    'PRAZDNE=',
  ].join('\n'));

  assert.equal(parsed.get('A'), 'v úvodzovkách');
  assert.equal(parsed.get('B'), 'v apostrofoch');
  assert.equal(parsed.get('C'), 'ha#sh');
  assert.equal(parsed.get('D'), 'hodnota');
  assert.equal(parsed.get('PRAZDNE'), '');
});

test('doctor povie zdroj, ale token nikdy nevypíše', async () => {
  const f = fixture({ withHomeConfig: false });
  const stub = await startStub({
    'GET /api/console/cli/models': ({ res }) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        models: [{ id: 'qwen3:8b', label: 'qwen3:8b', provider: 'ollama' }],
        default: { provider: 'ollama', model: 'qwen3:8b' },
        unavailable: ['anthropic'],
      }));
    },
  });

  try {
    const out = sink();
    const err = sink();
    const code = await main(['doctor'], {
      env: { HADES_URL: stub.url },
      home: f.home,
      cwd: f.deep,
      out,
      err,
    });

    assert.equal(code, 0);
    assert.match(out.text, /našel som ho/);
    assert.match(out.text, /\.env/, 'doctor má povedať, z ktorého zdroja token vzal');
    assert.match(out.text, /odpovedá/);

    // Toto je to podstatné: hodnota tajomstva nesmie byť ani v stdout, ani v
    // stderr, ani skrátená. `doctor` je príkaz, ktorého výstup ľudia kopírujú.
    assert.equal(out.text.includes(DOTENV_TOKEN), false, 'token je v stdout');
    assert.equal(err.text.includes(DOTENV_TOKEN), false, 'token je v stderr');
    for (let len = 6; len <= DOTENV_TOKEN.length; len += 1) {
      assert.equal(out.text.includes(DOTENV_TOKEN.slice(0, len)), false, `v stdout je prefix tokenu (${len} znakov)`);
    }
  } finally {
    await stub.close();
  }
});

test('doctor bez tokenu skončí návodom a kódom 2, nie traceom', async () => {
  const f = fixture({ withHomeConfig: false });
  const empty = mkdtempSync(join(tmpdir(), 'hades-prazdno-'));
  const out = sink();
  const err = sink();

  const code = await main(['doctor'], { env: {}, home: f.home, cwd: empty, out, err });

  assert.equal(code, 2);
  assert.match(out.text, /NENAŠEL SOM HO/);
  assert.match(out.text, /HADES_UI_TOKEN/);
  assert.equal(out.text.includes('at Object.'), false, 'toto nemá byť stack trace');
});

test('bez tokenu skončí kódom 2 aj bežný príkaz', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'hades-prazdno-'));
  const home = mkdtempSync(join(tmpdir(), 'hades-domov-'));
  const out = sink();
  const err = sink();

  const code = await main(['models'], { env: {}, home, cwd: empty, out, err });

  assert.equal(code, 2);
  assert.match(err.text, /Nenašiel som token/);
});
