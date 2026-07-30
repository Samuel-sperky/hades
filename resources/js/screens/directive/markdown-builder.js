/* Klientsky builder markdownu smernice — čistá funkcia, testovaná vo Vitest.

   Zrkadlí `DirectiveController::buildMarkdown`, ale skladá LEN zo zaškrtnutých
   položiek, aby odškrtnuté zostalo odškrtnuté aj v náhľade.

   ZMENA P10: sekcia „Kde nájdeš" je zrušená (akceptačné kritérium balíka).
   Duplikovala zoznamy nad sebou — každý overený skill aj projekt tam bol druhý
   raz s tou istou cestou — a v prompte pre Claude Code to boli len spálené tokeny.
   Cesty zostávajú tam, kde patria: pri skille v „Použi tieto skilly". */

const HEADINGS = {
    skills: 'Použi tieto skilly',
    projects: 'Súvisiace projekty',
    facts: 'Kľúčové fakty',
    rules: 'Pravidlá a preferencie',
};


/** Jednoriadkový úryvok s tvrdým stropom. */
export function oneLine(text, max = 160) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max) + '…' : t;
}


/** Úvodná veta „Kontextu". `AuraAI`, nie `Hades` (rebranding W1). */
export function contextSentence(task, verified, projects) {
    const subject = task !== '' ? '„' + task + '"' : 'túto úlohu';
    const parts = [];
    if (verified.length) parts.push(verified.length + '× skill');
    if (projects.length) parts.push(projects.length + '× projekt');
    const have = parts.length ? ' Zahŕňa ' + parts.join(' a ') + '.' : '';
    return 'Táto smernica hovorí, kde v AuraAI nájdeš relevantné znalosti pre '
        + subject + '.' + have + ' Použi uvedené zdroje ako kontext skôr, než začneš.';
}


/**
 * @param {string} task
 * @param {{skills:Array, projects:Array, facts:Array, rules:Array}} picked
 * @returns {string} markdown ukončený jedným newline
 */
export function buildDirectiveMarkdown(task, picked) {
    const t = String(task || '').trim();
    const skills = picked.skills || [];
    const projects = picked.projects || [];
    const facts = picked.facts || [];
    const rules = picked.rules || [];
    const verified = skills.filter((s) => s.verified && s.path);

    const L = ['# Smernica: ' + (t !== '' ? t : 'Nešpecifikovaná úloha'), ''];
    L.push('## Kontext', contextSentence(t, verified, projects), '');

    if (verified.length) {
        L.push('## ' + HEADINGS.skills);
        for (const s of verified) L.push('- ' + s.label + ' — `' + s.path + '`');
        L.push('');
    }
    if (projects.length) {
        L.push('## ' + HEADINGS.projects);
        for (const p of projects) {
            const info = String(p.info || '').trim();
            L.push('- ' + p.label + (info !== '' ? ': ' + info : ''));
        }
        L.push('');
    }
    for (const [key, items] of [['facts', facts], ['rules', rules]]) {
        if (!items.length) continue;
        L.push('## ' + HEADINGS[key]);
        for (const it of items) {
            const s = oneLine(it.snippet);
            L.push('- ' + it.label + (s !== '' ? ': ' + s : ''));
        }
        L.push('');
    }

    return L.join('\n').replace(/\n+$/, '') + '\n';
}
