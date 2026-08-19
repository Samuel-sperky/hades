// Čítanie NDJSON prúdu: rozpolené rámce, rozpolená diakritika, neznámy typ
// rámca a prúd, ktorý skončil bez ukončovacieho rámca.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  TURN_ABORTED,
  TURN_END,
  TURN_INTERRUPTED,
  createClient,
  driveTurn,
  readNdjson,
} from '../lib/api.mjs';
import { createRenderer } from '../lib/render.mjs';
import { frames, sendChunks, sink, sleep, startStub } from './support/stub.mjs';

/** ReadableStream z presne daných bajtových chunkov — bez TCP a bez náhody. */
function streamOf(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function collect(stream) {
  const out = [];
  for await (const frame of readNdjson(stream)) out.push(frame);

  return out;
}

test('rámec rozdelený medzi dva chunky sa poskládá — a to na KAŽDOM mieste rezu', async () => {
  const bytes = new TextEncoder().encode(
    frames({ t: 'delta', text: 'ahoj' }, { t: 'end', stop_reason: 'stop' }).join(''),
  );

  // Rez na každom bajte, nie na jednom „reprezentatívnom": chyba v bufferi sa
  // typicky prejaví len pri reze v konkrétnom mieste (za `{`, pred `\n`, …).
  for (let cut = 1; cut < bytes.length; cut += 1) {
    const got = await collect(streamOf([bytes.slice(0, cut), bytes.slice(cut)]));

    assert.deepEqual(
      got,
      [{ t: 'delta', text: 'ahoj' }, { t: 'end', stop_reason: 'stop' }],
      `rez na bajte ${cut} rozsypal prúd`,
    );
  }
});

test('viacbajtový znak rozdelený medzi chunky sa nerozsype na U+FFFD', async () => {
  const text = 'Ťažké šťastie: vedomie žije ďalej – naozaj.';
  const bytes = new TextEncoder().encode(frames({ t: 'delta', text }).join(''));

  // Rezy vnútri viacbajtových sekvencií (0b10xxxxxx je pokračovací bajt).
  const cuts = [...bytes.keys()].filter((i) => (bytes[i] & 0xC0) === 0x80);
  assert.ok(cuts.length > 5, 'test bez viacbajtových znakov by nemeral nič');

  for (const cut of cuts) {
    const got = await collect(streamOf([bytes.slice(0, cut), bytes.slice(cut)]));

    assert.equal(got.length, 1, `rez na bajte ${cut} rozsypal rámec`);
    assert.equal(got[0].text, text, `rez na bajte ${cut} pokazil znaky`);
    assert.ok(!String(got[0].text).includes('�'), 'v texte je náhradný znak');
  }
});

test('posledný riadok bez konca riadku sa nezahodí', async () => {
  const got = await collect(streamOf([new TextEncoder().encode('{"t":"end","stop_reason":"stop"}')]));

  assert.deepEqual(got, [{ t: 'end', stop_reason: 'stop' }]);
});

test('nerozparsovateľný riadok sa preskočí a prúd pokračuje', async () => {
  const raw = '{"t":"delta","text":"a"}\nTOTO NIE JE JSON\n{"t":"end"}\n';
  const got = await collect(streamOf([new TextEncoder().encode(raw)]));

  assert.deepEqual(got, [{ t: 'delta', text: 'a' }, { t: 'end' }]);
});

test('neznámy typ rámca sa ignoruje a beh dobehne', async () => {
  const stub = await startStub({
    'POST /api/console/cli/run': ({ res }) => sendChunks(res, frames(
      { t: 'start', message_id: 1, model: 'qwen3:8b', provider: 'ollama' },
      { t: 'kozmicky_ramec_z_buducnosti', payload: { hocico: [1, 2, 3] } },
      { t: 'delta', text: 'odpoveď' },
      { t: 'end', stop_reason: 'stop', tokens_in: 10, tokens_out: 3, tokens_per_second: 9.3 },
    )),
  });

  try {
    const client = createClient({ url: stub.url, token: 'stub' });
    const out = sink();
    const renderer = createRenderer({ out, err: out, color: false });
    const seen = [];

    const result = await driveTurn({
      client,
      body: { thread: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', message: 'ahoj' },
      onFrame: (frame) => { seen.push(frame.t); renderer.frame(frame); },
    });

    assert.equal(result.status, TURN_END);
    assert.ok(seen.includes('kozmicky_ramec_z_buducnosti'), 'rámec sa mal doručiť, nie zahodiť pri parsovaní');
    assert.match(out.text, /odpoveď/);
    // Ignorovanie znamená „nekreslí sa a nepadá", nie „nedorazí".
    assert.doesNotMatch(out.text, /kozmicky_ramec/);
  } finally {
    await stub.close();
  }
});

test('prúd bez `end` aj bez `error` je PRERUŠENÝ, nie úspešný', async () => {
  const stub = await startStub({
    'POST /api/console/cli/run': async ({ res }) => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(frames({ t: 'start', message_id: 1 }, { t: 'delta', text: 'polovica ' }).join(''));
      // Server spadol / spojenie sa pretrhlo uprostred ťahu.
      res.end();
    },
  });

  try {
    const client = createClient({ url: stub.url, token: 'stub' });
    const out = sink();
    const renderer = createRenderer({ out, err: out, color: false });

    const result = await driveTurn({
      client,
      body: { thread: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', message: 'ahoj' },
      onFrame: (frame) => renderer.frame(frame),
    });

    assert.equal(result.status, TURN_INTERRUPTED);

    renderer.turnResult(result);
    assert.match(out.text, /PRERUŠENÝ/);
  } finally {
    await stub.close();
  }
});

test('prerušenie behu (Ctrl+C) nechá na obrazovke to, čo už pritieklo', async () => {
  const stub = await startStub({
    'POST /api/console/cli/run': async ({ res }) => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(frames({ t: 'start', message_id: 1 }, { t: 'delta', text: 'prvá časť ' }).join(''));

      await sleep(400);

      // Po prerušení je spojenie mŕtve; zápis do neho by len hodil výnimku.
      if (!res.writableEnded && !res.destroyed) {
        res.write(frames({ t: 'delta', text: 'druhá časť' }, { t: 'end', stop_reason: 'stop' }).join(''));
        res.end();
      }
    },
  });

  try {
    const client = createClient({ url: stub.url, token: 'stub' });
    const out = sink();
    const renderer = createRenderer({ out, err: out, color: false });
    const controller = new AbortController();

    const result = await driveTurn({
      client,
      body: { thread: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', message: 'hovor dlho' },
      onFrame: (frame) => {
        renderer.frame(frame);
        // Presne to, čo robí ^C v smyčke: zruší request uprostred prúdu.
        if (frame.t === 'delta') controller.abort();
      },
      signal: controller.signal,
    });

    assert.equal(result.status, TURN_ABORTED);
    assert.match(out.text, /prvá časť/);
    assert.doesNotMatch(out.text, /druhá časť/);

    renderer.turnResult(result);
    assert.match(out.text, /zastavený/);
  } finally {
    await stub.close();
  }
});
