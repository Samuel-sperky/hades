// Vykresľovanie: skrátenie dlhého výsledku (a priznanie, že sa skrátilo),
// zhrnutie argumentov toolu a mlčanie nad neznámym rámcom.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clip, createRenderer, duration, summarizeArgs } from '../lib/render.mjs';
import { sink } from './support/stub.mjs';

test('dlhý výsledok sa skráti A klient to prizná', () => {
  const long = Array.from({ length: 200 }, (_, i) => `riadok ${i}`).join('\n');
  const clipped = clip(long, 12, 100000);

  assert.equal(clipped.split('\n').length, 13, '12 riadkov + veta o skrátení');
  assert.match(clipped, /skrátené: ešte 188 riadkov/);
  // Toto je to podstatné: tiché strihnutie by zamlčalo, že v odstrihnutom
  // zvyšku môže byť „3 tests failed".
  assert.match(clipped, /celý výsledok je vo vlákne/);
});

test('krátky výsledok sa nechá na pokoji', () => {
  assert.equal(clip('jeden riadok', 12, 1000), 'jeden riadok');
});

test('karta toolu vypíše kľúčový argument, nie celý JSON', () => {
  assert.equal(summarizeArgs('bash', { command: 'php artisan test --filter=Console' }), 'php artisan test --filter=Console');
  assert.equal(summarizeArgs('read_file', { path: 'app/X.php', offset: 20, limit: 40 }), 'app/X.php · od 20 · 40 r.');
  assert.equal(summarizeArgs('grep', { pattern: 'mind_recall', path: 'app' }), '/mind_recall/ v app');
  assert.equal(summarizeArgs('mind_recall', { topic: 'konzola', limit: 8 }), 'topic=konzola · limit=8');

  // Obsah súboru sa do karty nesype — na to je náhľad pri povolení.
  const summary = summarizeArgs('write_file', { path: 'app/X.php', content: 'x'.repeat(5000) });
  assert.equal(summary, 'app/X.php');
});

test('viacriadkový príkaz sa do karty zmestí na jeden riadok', () => {
  const summary = summarizeArgs('bash', { command: 'cd /var/www\nphp artisan test' });

  assert.equal(summary.includes('\n'), false);
  assert.match(summary, /cd \/var\/www php artisan test/);
});

test('čas sa píše po slovensky: ms pod sekundu, desatina nad ňou', () => {
  assert.equal(duration(0), '0 ms');
  assert.equal(duration(340), '340 ms');
  assert.equal(duration(4200), '4,2 s');
});

test('neznámy rámec nevykreslí nič a nespadne', () => {
  const out = sink();
  const renderer = createRenderer({ out, err: out, color: false });

  renderer.frame({ t: 'nieco_nove', text: 'toto sa nemá objaviť' });
  renderer.frame({ });
  renderer.frame({ t: 'delta', text: 'a toto áno' });

  assert.equal(out.text, 'a toto áno');
});

test('karta toolu sa neprilepí na rozpísanú vetu modelu', () => {
  const out = sink();
  const renderer = createRenderer({ out, err: out, color: false });

  renderer.frame({ t: 'delta', text: 'Pozriem sa na to' });
  renderer.frame({ t: 'tool', id: 1, name: 'bash', arguments: { command: 'ls' }, write: false });

  // Bez zlomu by karta začala na tom istom riadku ako veta a výpis by sa zlial.
  assert.match(out.text, /Pozriem sa na to\n/);
});

test('stav toolu nesie meno z rámca `tool` — `tool_result` ho neposiela', () => {
  const out = sink();
  const renderer = createRenderer({ out, err: out, color: false });

  renderer.frame({ t: 'tool', id: 12, name: 'ripgrep', arguments: { pattern: 'x' }, write: false });
  renderer.frame({ t: 'tool_result', id: 12, status: 'failed', result: 'nič', duration_ms: 9 });

  assert.match(out.text, /zlyhalo/);
  assert.match(out.text, /ripgrep/);
});
