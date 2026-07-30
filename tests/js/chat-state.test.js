import { describe, it, expect, beforeEach } from 'vitest';
import {
    chatState, historyForSend, lastUserMessage, loadChatState, newConversation,
    persistDraft, pushMessage, replaceMessages, setMode, setModel,
} from '../../resources/js/chat/state.js';

/** Zabudni len pamäť procesu — localStorage zostáva, presne ako pri reloade. */
function resetMemory() {
    chatState.mode = 'quickbar';
    chatState.conversationId = null;
    chatState.title = null;
    chatState.messages = [];
    chatState.draft = '';
    chatState.streaming = false;
    chatState.model = null;
    chatState.threads = [];
    chatState.remote = true;
}

function reset() {
    localStorage.clear();
    resetMemory();
}

describe('chat/state.js — jeden stav pre tri režimy', () => {
    beforeEach(reset);

    it('persists the mode under the aura. namespace', () => {
        setMode('overlay');
        expect(chatState.mode).toBe('overlay');
        expect(localStorage.getItem('aura.chatMode')).toBe('overlay');
    });

    it('rejects an unknown mode', () => {
        setMode('overlay');
        setMode('nonsense');
        expect(chatState.mode).toBe('overlay');
    });

    it('survives a reload: draft, mode and messages come back', () => {
        setMode('screen');
        chatState.draft = 'rozpisana veta';
        persistDraft();
        chatState.conversationId = 42;
        chatState.title = 'Vlakno';
        pushMessage({ role: 'user', content: 'ahoj' });
        pushMessage({ role: 'assistant', content: 'ahoj aj tebe', model: 'qwen3:4b' });

        resetMemory();
        loadChatState();

        expect(chatState.mode).toBe('screen');
        expect(chatState.draft).toBe('rozpisana veta');
        expect(chatState.conversationId).toBe(42);
        expect(chatState.messages).toHaveLength(2);
        expect(chatState.messages[1].model).toBe('qwen3:4b');
    });

    it('keeps system notes out of the reload mirror', () => {
        pushMessage({ role: 'user', content: 'x' });
        pushMessage({ role: 'system', content: 'Priveľa otázok', error: true });
        resetMemory();
        loadChatState();
        expect(chatState.messages.map((m) => m.role)).toEqual(['user']);
    });

    it('tolerates a corrupted mirror', () => {
        localStorage.setItem('aura.chatMirror', '{not json');
        expect(() => loadChatState()).not.toThrow();
        expect(chatState.messages).toEqual([]);
    });

    it('historyForSend drops system, error and pending bubbles and caps at 12', () => {
        for (let i = 0; i < 10; i += 1) {
            pushMessage({ role: 'user', content: 'q' + i });
            pushMessage({ role: 'assistant', content: 'a' + i });
        }
        pushMessage({ role: 'system', content: 'sys' });
        pushMessage({ role: 'assistant', content: 'pending', pending: true });
        const h = historyForSend();
        expect(h).toHaveLength(12);
        expect(h.every((m) => m.role === 'user' || m.role === 'assistant')).toBe(true);
        expect(h.some((m) => m.content === 'sys')).toBe(false);
        expect(h.some((m) => m.content === 'pending')).toBe(false);
    });

    it('lastUserMessage finds the newest user turn', () => {
        pushMessage({ role: 'user', content: 'prva' });
        pushMessage({ role: 'assistant', content: 'odpoved' });
        pushMessage({ role: 'user', content: 'druha' });
        pushMessage({ role: 'assistant', content: 'odpoved 2' });
        expect(lastUserMessage().content).toBe('druha');
    });

    it('newConversation clears the thread but keeps the draft', () => {
        chatState.draft = 'nedokoncene';
        pushMessage({ role: 'user', content: 'x' });
        chatState.conversationId = 7;
        newConversation();
        expect(chatState.messages).toEqual([]);
        expect(chatState.conversationId).toBeNull();
        expect(chatState.draft).toBe('nedokoncene');
    });

    it('setModel(null) removes the stored preference', () => {
        setModel('qwen3:4b');
        expect(localStorage.getItem('aura.chatModel')).toBe('qwen3:4b');
        setModel(null);
        expect(localStorage.getItem('aura.chatModel')).toBeNull();
    });

    it('replaceMessages swaps the whole thread', () => {
        pushMessage({ role: 'user', content: 'a' });
        replaceMessages([{ id: 'x', role: 'assistant', content: 'b' }]);
        expect(chatState.messages).toHaveLength(1);
        expect(chatState.messages[0].content).toBe('b');
    });

    it('gives every message a unique id', () => {
        const ids = new Set();
        for (let i = 0; i < 50; i += 1) ids.add(pushMessage({ role: 'user', content: 'x' }).id);
        expect(ids.size).toBe(50);
    });
});
