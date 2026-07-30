import { describe, it, expect, beforeEach } from 'vitest';
import { S } from '../../resources/js/core/state/index.js';
import { conversationToMarkdown } from '../../resources/js/chat/export.js';

beforeEach(() => {
    S.byId = new Map([[11, { id: 11, label: 'Vite build step', type: 'skill' }]]);
});

describe('chat/export.js — konverzácia do Markdownu (rozhodnutie 100)', () => {
    const state = {
        conversationId: 42,
        title: 'Ako beží build',
        messages: [
            { role: 'user', content: 'Ako beží build?' },
            { role: 'system', content: 'toto sa neexportuje' },
            {
                role: 'assistant', content: 'Cez **Vite**.', model: 'qwen3:4b',
                ms: 1200, tokPerS: 11.7, citations: [11, 999],
            },
        ],
    };

    it('writes the AuraAI frontmatter marker', () => {
        const md = conversationToMarkdown(state);
        expect(md.startsWith('---\nsource: auraai\n')).toBe(true);
        expect(md).toContain('conversation_id: 42');
        expect(md).toContain('kind: chat');
    });

    it('keeps both turns and drops system notes', () => {
        const md = conversationToMarkdown(state);
        expect(md).toContain('## Ja');
        expect(md).toContain('## AuraAI');
        expect(md).toContain('Ako beží build?');
        expect(md).toContain('Cez **Vite**.');
        expect(md).not.toContain('toto sa neexportuje');
    });

    it('records the micro-label and only resolvable citations', () => {
        const md = conversationToMarkdown(state);
        expect(md).toContain('_qwen3:4b · 12 tok/s · 1200 ms_');
        expect(md).toContain('Vychádzal som z: Vite build step');
        expect(md).not.toContain('999');
    });

    it('handles an empty conversation without throwing', () => {
        const md = conversationToMarkdown({ conversationId: null, title: null, messages: [] });
        expect(md).toContain('# Chat s AuraAI');
        expect(md).not.toContain('conversation_id');
    });
});
