/* Slash príkazy nad vedomím (rozhodnutie 91). Register je zároveň zdrojom pre
   autocomplete, takže zoznam existuje na jednom mieste. Každý príkaz beží
   lokálne — žiadny nepotrebuje model ani beh Ollamy. */

import { apiGet } from '../core/api.js';
import { $ } from '../core/dom.js';
import { S } from '../core/state/index.js';
import { fitView, zoomBy } from '../graph/camera.js';
import { setView } from '../graph/view.js';
import { closeCmdk, openCmdk, renderCmdk } from '../shell/cmdk.js';
import { openDock } from '../shell/dock.js';
import { toggleHelp } from '../shell/help.js';
import { setScreen } from '../shell/router.js';
import { clearChatContext } from './context.js';
import { exportConversation } from './export.js';
import { chatState, setModel } from './state.js';
import { renderSuggestCard } from './suggest.js';

/** { name, hint, aliases } — poradie riadi aj ponuku v autocomplete. */
export const COMMANDS = [
    { name: 'zapamataj', hint: 'ulož novú spomienku do vedomia', aliases: ['remember'] },
    { name: 'kontext', hint: 'zobraz alebo vyčisti priložené uzly (/kontext clear)' },
    { name: 'najdi', hint: 'otvor hľadanie', aliases: ['find'] },
    { name: 'nahlad', hint: 'mapa | siet | vrstvy', aliases: ['view'] },
    { name: 'zoom', hint: 'in | out | fit' },
    { name: 'model', hint: 'vyber model pre odpovede' },
    { name: 'export', hint: 'ulož konverzáciu do Markdownu' },
    { name: 'smernica', hint: 'prejdi na obrazovku Smernica' },
    { name: 'prepoj', hint: 'ako prepojiť dva uzly' },
    { name: 'legenda', hint: 'otvor legendu' },
    { name: 'statistiky', hint: 'otvor štatistiky', aliases: ['stats'] },
    { name: 'pomoc', hint: 'klávesové skratky', aliases: ['help'] },
];

const NAMES = COMMANDS.flatMap((c) => [c.name, ...(c.aliases || [])]);

export function isKnownCommand(name) {
    return NAMES.includes(String(name || '').toLowerCase());
}

/**
 * @param {string} text  celý riadok vrátane úvodného '/'
 * @param {(msg: string, isError?: boolean) => void} sys  zápis systémovej správy do logu
 */
export async function handleCommand(text, sys) {
    const parts = text.slice(1).split(/\s+/);
    const cmd = (parts.shift() || '').toLowerCase();
    const arg = parts.join(' ').trim();

    switch (cmd) {
        case 'zapamataj': case 'remember':
            if (!arg) { sys('Použi: /zapamataj <čo si mám zapamätať>'); break; }
            renderSuggestCard({ label: arg.slice(0, 255), type: 'memory' });
            break;

        case 'kontext': {
            if (arg.toLowerCase() === 'clear' || arg.toLowerCase() === 'vycisti') {
                clearChatContext();
                sys('Kontext vyčistený.');
                break;
            }
            const labels = [...S.chatContext].filter((id) => S.byId.has(id)).map((id) => S.byId.get(id).label);
            sys(labels.length ? 'V kontexte: ' + labels.join(', ') : 'Kontext je prázdny. Priloži uzol cez @názov.');
            break;
        }

        case 'nahlad': case 'view': {
            const map = { mapa: 'map', siet: 'net', 'sieť': 'net', vrstvy: 'layers' };
            const v = map[arg.toLowerCase()];
            if (v) { setView(v); sys('Náhľad prepnutý: ' + arg); }
            else sys('Použi: /nahlad mapa | siet | vrstvy');
            break;
        }

        case 'najdi': case 'find':
            closeCmdk();
            openCmdk();
            if (arg) { $('cmdk-input').value = arg; renderCmdk(arg); }
            sys(arg ? 'Hľadám: ' + arg : 'Otvoril som hľadanie.');
            break;

        case 'zoom':
            if (arg === 'in') zoomBy(1.3);
            else if (arg === 'out') zoomBy(1 / 1.3);
            else fitView();
            sys('Zoom upravený.');
            break;

        case 'model': {
            if (arg) { setModel(arg); sys('Model pre ďalšie odpovede: ' + arg); break; }
            try {
                const payload = await apiGet('/api/chat/models', { timeoutMs: 6000, retry: 0 });
                const list = (payload && (payload.models || payload.data)) || [];
                const names = list.map((m) => (typeof m === 'string' ? m : m.name || m.model)).filter(Boolean);
                sys(names.length
                    ? 'Dostupné modely: ' + names.join(', ') + (chatState.model ? ' (teraz: ' + chatState.model + ')' : '')
                    : 'Runtime nevrátil žiadny model — odpovedám z pamäte.');
            } catch (err) {
                sys('Zoznam modelov sa nedá načítať. Model si vyberie server: /model <názov> ho vynúti.');
            }
            break;
        }

        case 'export':
            exportConversation();
            sys('Konverzácia uložená do Markdownu.');
            break;

        case 'smernica':
            setScreen('smernica');
            sys('Obrazovka Smernica otvorená.');
            break;

        case 'prepoj':
            sys('Prepájanie: vyber uzol na plátne a v jeho paneli stlač Prepojiť, potom klikni na druhý uzol.');
            break;

        case 'legenda': openDock('legend'); sys('Legenda otvorená.'); break;
        case 'statistiky': case 'stats': openDock('stats'); sys('Štatistiky otvorené.'); break;
        case 'pomoc': case 'help': toggleHelp(true); break;

        default:
            sys('Neznámy príkaz. Napíš / a vyber zo zoznamu.', true);
    }
}
