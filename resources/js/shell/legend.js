import { $, esc } from '../core/dom.js';
import { S } from '../core/state/index.js';
import { persistFilter } from '../graph/filters.js';
import { draw } from '../graph/render/draw.js';


// Tvarové glyfy typov — neutrálny ink (var(--muted)); farba v legende patrí len oblastiam.
// Jadro je jediná výnimka: dvojitý zlatý prstenec (brand moment).
const TYPE_GLYPHS = {
    memory: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="var(--muted)"/></svg>',
    skill: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="var(--muted)"/><circle cx="8" cy="8" r="2.3" fill="var(--bg)"/></svg>',
    project: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4.5" fill="var(--muted)"/><circle cx="8" cy="8" r="6.8" fill="none" stroke="var(--muted)" stroke-opacity=".7" stroke-width="1.2"/></svg>',
    core: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4" fill="var(--gold)"/><circle cx="8" cy="8" r="6.8" fill="none" stroke="var(--gold)" stroke-opacity=".5" stroke-width="1.2"/></svg>',
};


export function buildLegend() {
    const typeNames = { memory: 'Spomienka', skill: 'Skill', project: 'Projekt', core: 'Jadro' };

    $('legend-types').innerHTML = Object.keys(typeNames).map(
        (t) => '<div class="legend-row">' + TYPE_GLYPHS[t] + '<span>' + typeNames[t] + '</span></div>'
    ).join('');

    // oblasti sú klikateľné filtre — riadok prepína viditeľnosť oblasti na plátne
    $('legend-areas').innerHTML = [...S.areas.values()].map((a) => {
        const off = S.filter.areas.has(a.id);
        return '<button type="button" class="legend-row legend-area' + (off ? ' off' : '')
            + '" data-area="' + a.id + '" aria-pressed="' + (off ? 'false' : 'true')
            + '" title="Prepnúť viditeľnosť oblasti">'
            + '<span class="swatch" style="background:' + esc(a.color)
            + ';box-shadow:0 0 6px ' + esc(a.color) + '"></span>'
            + '<span class="la-name">' + esc(a.name) + '</span>'
            + '<span class="ms la-eye" aria-hidden="true">' + (off ? 'visibility_off' : 'visibility') + '</span>'
            + '</button>';
    }).join('');

    $('legend-areas').querySelectorAll('.legend-area').forEach((row) => {
        row.onclick = () => {
            const id = +row.dataset.area;
            const off = !S.filter.areas.has(id);
            if (off) S.filter.areas.add(id); else S.filter.areas.delete(id);
            row.classList.toggle('off', off);
            row.setAttribute('aria-pressed', off ? 'false' : 'true');
            row.querySelector('.la-eye').textContent = off ? 'visibility_off' : 'visibility';
            persistFilter();
            draw();
        };
    });

    const strengthEl = $('legend-strength');
    if (strengthEl) {
        strengthEl.innerHTML = '<div class="legend-row legend-strength">'
            + [6, 10, 14].map((d) =>
                '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="' + (d / 2) + '" fill="var(--muted)"/></svg>'
            ).join('')
            + '<span class="cap">slabšia → silnejšia</span></div>';
    }

    // A10 + FÁZA HRANY: druhy spojení — jedna ink farba, rozlíšenie štýlom čiary.
    // relation (part_of kostra, uses) má prednosť pred kind (aktivácia, podobnosť).
    const connEl = $('legend-connections');
    if (connEl) {
        const line = (dash, w) =>
            '<svg width="26" height="10" viewBox="0 0 26 10" aria-hidden="true">'
            + '<line x1="1" y1="5" x2="25" y2="5" stroke="var(--muted)" stroke-width="' + (w || 1.4) + '"'
            + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/></svg>';
        connEl.innerHTML =
            '<div class="legend-row">' + line('', 1) + '<span>Kostra · part_of</span></div>'
            + '<div class="legend-row">' + line('') + '<span>Ručné · silné</span></div>'
            + '<div class="legend-row">' + line('6 4') + '<span>Použitie · uses</span></div>'
            + '<div class="legend-row">' + line('5 3') + '<span>Spoločná aktivácia</span></div>'
            + '<div class="legend-row">' + line('1.5 3') + '<span>Podobnosť</span></div>';
    }
}
