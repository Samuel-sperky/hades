import { $ } from '../core/dom.js';


export function collapsePrompt() {
    $('prompt').classList.remove('open');
    $('chat-log').classList.add('hidden');
    $('prompt-input').blur();
}
