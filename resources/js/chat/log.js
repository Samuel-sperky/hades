import { $ } from '../core/dom.js';


/* ---------- chat ---------- */

export const chatHistory = [];


export function addMsg(cls, text) {
    const log = $('chat-log');
    log.classList.remove('hidden');
    const div = document.createElement('div');
    div.className = 'msg ' + cls;
    if (cls.indexOf('thinking') !== -1) {
        div.innerHTML = '<span class="dot">·</span><span class="dot">·</span><span class="dot">·</span>';
    } else {
        div.textContent = text;
    }
    // Hadesove odpovede (aj thinking) dostanú avatar so zlatým prstencom
    let el = div;
    if (cls.indexOf('hades') !== -1) {
        el = document.createElement('div');
        el.className = 'msg-row';
        el.innerHTML = '<span class="avatar" aria-hidden="true">H</span>';
        el.appendChild(div);
    }
    log.appendChild(el);
    log.scrollTop = 1e9;
    return el;
}
