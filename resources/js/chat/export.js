/* Export konverzácie do Markdownu (rozhodnutie 100). Beží celý v prehliadači —
   žiadny endpoint, takže funguje aj bez backendu. */

import { S } from '../core/state/index.js';
import { chatState } from './state.js';

function stamp(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
        + '_' + p(d.getHours()) + p(d.getMinutes());
}

// NFD rozloží diakritiku na kombinujúce značky, orez na ASCII ich potom zahodí —
// z „Šperky“ vznikne „sperky“ bez tabuľky mapovaní.
function slug(text) {
    return String(text || 'chat').toLowerCase()
        .normalize('NFD')
        .replace(/[^\x20-\x7E]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'chat';
}

/** Konverzácia → markdown text. Čistá funkcia, testovateľná bez DOM. */
export function conversationToMarkdown(state = chatState) {
    const lines = [];
    lines.push('---');
    lines.push('source: auraai');
    lines.push('kind: chat');
    lines.push('title: ' + (state.title || 'Chat s AuraAI'));
    lines.push('exported_at: ' + new Date().toISOString());
    if (state.conversationId != null) lines.push('conversation_id: ' + state.conversationId);
    lines.push('---');
    lines.push('');
    lines.push('# ' + (state.title || 'Chat s AuraAI'));
    lines.push('');

    for (const m of state.messages) {
        if (m.role === 'system') continue;
        lines.push(m.role === 'user' ? '## Ja' : '## AuraAI');
        const meta = [m.model, m.tokPerS ? Math.round(m.tokPerS) + ' tok/s' : null,
            m.ms ? Math.round(m.ms) + ' ms' : null, m.degraded ? 'z pamäte' : null].filter(Boolean);
        if (meta.length) lines.push('_' + meta.join(' · ') + '_');
        lines.push('');
        lines.push(String(m.content || '').trim());
        lines.push('');
        const cites = (m.citations || []).map((id) => +id).filter((id) => S.byId.has(id));
        if (cites.length) {
            lines.push('Vychádzal som z: ' + cites.map((id) => S.byId.get(id).label).join(', '));
            lines.push('');
        }
    }
    return lines.join('\n');
}

export function exportConversation(state = chatState) {
    const md = conversationToMarkdown(state);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'auraai-chat_' + slug(state.title) + '_' + stamp() + '.md';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return md;
}
