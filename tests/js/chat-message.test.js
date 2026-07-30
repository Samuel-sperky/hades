import { describe, it, expect, beforeEach } from 'vitest';
import { S } from '../../resources/js/core/state/index.js';
import { buildMessage, finishStreamingRow, metaLine, updateStreamingBubble } from '../../resources/js/chat/message.js';

beforeEach(() => {
    S.byId = new Map([
        [11, { id: 11, label: 'Vite build step', type: 'skill' }],
        [12, { id: 12, label: 'AuraAI', type: 'core' }],
    ]);
});

describe('chat/message.js — markdown v bubline (rozhranie #10)', () => {
    it('renders assistant markdown as HTML, not as text', () => {
        const el = buildMessage({ id: 'a1', role: 'assistant', content: '**tučné** a `kód`' });
        const bubble = el.querySelector('.msg');
        expect(bubble.querySelector('strong').textContent).toBe('tučné');
        expect(bubble.querySelector('code').textContent).toBe('kód');
    });

    it('renders a table and a link in an answer', () => {
        const md = '| Model | tok/s |\n| --- | --- |\n| qwen3:4b | 12 |\n\n[docs](https://ollama.com)';
        const el = buildMessage({ id: 'a2', role: 'assistant', content: md });
        expect(el.querySelector('table.md-table')).toBeTruthy();
        expect(el.querySelector('a.md-link').getAttribute('href')).toBe('https://ollama.com');
        expect(el.querySelector('a.md-link').getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('adds a copy button to code blocks in answers', () => {
        const el = buildMessage({ id: 'a3', role: 'assistant', content: '```\nnpm run build\n```' });
        expect(el.querySelector('.md-copy')).toBeTruthy();
        expect(el.querySelector('pre code').textContent).toBe('npm run build');
    });

    it('never executes HTML smuggled in a model answer', () => {
        const el = buildMessage({ id: 'a4', role: 'assistant', content: '<img src=x onerror="alert(1)">' });
        expect(el.querySelector('img')).toBeNull();
        expect(el.querySelector('.msg').textContent).toContain('<img');
    });

    it('keeps user text literal (no markdown, no HTML)', () => {
        const el = buildMessage({ id: 'u1', role: 'user', content: '<b>ahoj</b> **nie tučné**' });
        const bubble = el.querySelector('.msg.me');
        expect(bubble.querySelector('b')).toBeNull();
        expect(bubble.textContent).toBe('<b>ahoj</b> **nie tučné**');
    });
});

describe('chat/message.js — a11y', () => {
    it('marks a streaming bubble busy so a reader does not read every token', () => {
        const el = buildMessage({ id: 's1', role: 'assistant', content: '' }, { streaming: true });
        const bubble = el.querySelector('.msg');
        expect(bubble.getAttribute('aria-live')).toBe('polite');
        expect(bubble.getAttribute('aria-atomic')).toBe('true');
        expect(bubble.getAttribute('aria-busy')).toBe('true');
    });

    it('hides the thinking indicator from readers (rozhodnutie 80)', () => {
        const el = buildMessage({ id: 's2', role: 'assistant', content: '' }, { streaming: true });
        expect(el.querySelector('.thinking').getAttribute('aria-hidden')).toBe('true');
    });

    it('drops aria-busy once the answer is finished', () => {
        const el = buildMessage({ id: 's3', role: 'assistant', content: '' }, { streaming: true });
        finishStreamingRow(el, { id: 's3', role: 'assistant', content: 'hotovo', model: 'qwen3:4b' });
        expect(el.querySelector('.msg').getAttribute('aria-busy')).toBe('false');
        expect(el.querySelector('.msg').textContent).toContain('hotovo');
    });

    it('gives every action button an accessible label', () => {
        const el = buildMessage({ id: 'a5', role: 'assistant', content: 'x' });
        const acts = [...el.querySelectorAll('[data-chat-action]')];
        expect(acts.length).toBeGreaterThan(0);
        expect(acts.every((b) => b.getAttribute('aria-label'))).toBe(true);
    });
});

describe('chat/message.js — citácie a mikro-label', () => {
    it('renders only citations whose node exists in the loaded graph', () => {
        const el = buildMessage({ id: 'c1', role: 'assistant', content: 'x', citations: [11, 999] });
        const chips = [...el.querySelectorAll('.cite-chip')];
        expect(chips).toHaveLength(1);
        expect(chips[0].textContent).toBe('Vite build step');
        expect(chips[0].dataset.chatAction).toBe('cite');
        expect(chips[0].dataset.nodeId).toBe('11');
    });

    it('escapes node labels in citation chips', () => {
        S.byId.set(13, { id: 13, label: '<script>x</script>', type: 'skill' });
        const el = buildMessage({ id: 'c2', role: 'assistant', content: 'x', citations: [13] });
        expect(el.querySelector('script')).toBeNull();
        expect(el.querySelector('.cite-chip').textContent).toBe('<script>x</script>');
    });

    it('formats the micro-label as model · tok/s · time', () => {
        expect(metaLine({ model: 'qwen3:4b', tokPerS: 11.6, ms: 1420 })).toBe('qwen3:4b · 12 tok/s · 1.4 s');
        expect(metaLine({ ms: 320 })).toBe('320 ms');
        expect(metaLine({ degraded: true })).toBe('z pamäte');
        expect(metaLine({})).toBe('');
    });

    it('updateStreamingBubble replaces the body without touching the row', () => {
        const el = buildMessage({ id: 's4', role: 'assistant', content: '' }, { streaming: true });
        updateStreamingBubble(el, '# Titul');
        expect(el.querySelector('h1')).toBeTruthy();
        expect(el.dataset.msgId).toBe('s4');
    });

    it('system messages carry no actions and no avatar', () => {
        const el = buildMessage({ id: 'y1', role: 'system', content: 'Priveľa otázok', error: true });
        expect(el.querySelector('.avatar')).toBeNull();
        expect(el.querySelector('[data-chat-action]')).toBeNull();
        expect(el.querySelector('.msg').className).toContain('sys--error');
    });
});
