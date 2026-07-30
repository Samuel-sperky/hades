import { addMsg } from './log.js';
import { $ } from '../core/dom.js';
import { fitView, zoomBy } from '../graph/camera.js';
import { setView } from '../graph/view.js';
import { closeCmdk, openCmdk, renderCmdk } from '../shell/cmdk.js';
import { openDock } from '../shell/dock.js';
import { toggleHelp } from '../shell/help.js';


export function handleCommand(text) {
    const parts = text.slice(1).split(/\s+/);
    const cmd = (parts.shift() || '').toLowerCase();
    const arg = parts.join(' ');
    const sys = (m) => addMsg('sys', m);

    switch (cmd) {
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
        case 'legenda': openDock('legend'); sys('Legenda otvorená.'); break;
        case 'statistiky': case 'stats': openDock('stats'); sys('Štatistiky otvorené.'); break;
        case 'pomoc': case 'help': toggleHelp(true); break;
        default:
            sys('Neznámy príkaz. Skús /nahlad, /najdi, /zoom, /legenda, /statistiky, /pomoc');
    }
}
