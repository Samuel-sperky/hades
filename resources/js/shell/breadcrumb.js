import { esc } from '../core/dom.js';
import { S } from '../core/state/index.js';
import { setFocus } from '../graph/focus.js';


export function renderBreadcrumb() {
    const bc = document.getElementById('breadcrumb');
    if (!bc) return;
    const area = S.focus.areaId ? S.areas.get(S.focus.areaId) : null;
    const dept = S.focus.departmentId ? S.departments.get(S.focus.departmentId) : null;

    if (!area) {
        bc.innerHTML = '<span class="crumb-idle">živé vedomie</span>';
        return;
    }

    let html = '<button type="button" class="crumb" data-bc="root">Hades</button><span class="sep">/</span>';
    if (dept) {
        html += '<button type="button" class="crumb" data-bc="area">' + esc(area.name) + '</button>'
            + '<span class="sep">/</span><span class="current">' + esc(dept.name) + '</span>';
    } else {
        html += '<span class="current">' + esc(area.name) + '</span>';
    }
    bc.innerHTML = html;

    bc.querySelectorAll('.crumb[data-bc]').forEach((b) => {
        b.onclick = () => setFocus(b.dataset.bc === 'area' ? area.id : null, null);
    });
}
