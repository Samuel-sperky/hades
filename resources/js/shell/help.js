import { $ } from '../core/dom.js';


const SHORTCUTS = [
    ['Ctrl K / F / /', 'Hľadať (paleta)'],
    ['1 / 2 / 3', 'Náhľad grafu: Mapa / Sieť / Vrstvy'],
    ['D', 'Denník'],
    ['R', 'Štruktúra'],
    ['S', 'Prehľad'],
    ['L', 'Legenda'],
    ['G', 'Lokálny graf zvoleného uzla'],
    ['N', 'Nový uzol'],
    ['+ / −', 'Zoom'],
    ['0', 'Vycentrovať'],
    ['?', 'Tento pomocník'],
    ['Esc', 'Zavrieť panely'],
];


const MOUSE_HINTS = [
    ['ťahanie', 'Posun plátna'],
    ['ťahanie uzla', 'Presun uzla (mapa / sieť)'],
    ['koliesko', 'Zoom'],
    ['klik na uzol', 'Detail'],
    ['dvojklik na oblasť', 'Zaostrenie oblasti'],
    ['Esc', 'Postupné zatváranie'],
];


let helpReturnFocus = null;


export function toggleHelp(show) {
    const el = $('help-overlay');
    const target = show === undefined ? el.classList.contains('hidden') : show;
    el.classList.toggle('hidden', !target);
    if (target && !$('help-body').children.length) {
        const row = ([k, d]) => {
            const caps = k.split(/\s*\/\s*/).map((x) => '<kbd>' + x + '</kbd>').join('<span class="sep">/</span>');
            return '<div class="key-row"><span class="label">' + d + '</span><span>' + caps + '</span></div>';
        };
        $('help-body').innerHTML = SHORTCUTS.map(row).join('')
            + '<h3>Myš</h3>'
            + MOUSE_HINTS.map(row).join('');
    }
    if (target) {
        helpReturnFocus = document.activeElement;
        $('help-close').focus();
    } else if (helpReturnFocus) {
        helpReturnFocus.focus();
        helpReturnFocus = null;
    }
}


export function register(root) {
    const btn = root.querySelector('#btn-help');
    if (btn) btn.onclick = () => toggleHelp(true);
}
