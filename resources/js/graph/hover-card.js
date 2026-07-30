import { $, esc } from '../core/dom.js';
import { S } from '../core/state/index.js';


// Karta žije v cudzom partiale (§3) — keď v layoute nie je, hover len tichšie mlčí.
function cardEl() {
    return $('hover-card');
}


export function hideHoverCard() {
    const card = cardEl();
    if (card) card.classList.remove('show');
}


export function updateHoverCard(e) {
    const card = cardEl();
    if (!card) return;
    const n = S.hover;

    if (!n) {
        card.classList.remove('show');
        return;
    }

    const typeNames = { core: 'jadro', skill: 'skill', memory: 'spomienka', project: 'projekt' };
    const area = S.areas.get(n.area_id);
    const dept = S.departments.get(n.department_id);
    const meta = [typeNames[n.type], area && area.name, dept && dept.name, 'sila ' + Math.round(n.strength || 1)]
        .filter(Boolean)
        .map((v) => esc(String(v)))
        .join(' · ');

    card.innerHTML = '<div class="t">' + esc(n.label) + '</div><div class="m">' + meta + '</div>';
    card.classList.remove('hidden');
    card.classList.add('show');

    const pad = 14;
    const r = card.getBoundingClientRect();
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
    card.style.left = x + 'px';
    card.style.top = y + 'px';
}
