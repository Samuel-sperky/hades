import { describe, it, expect } from 'vitest';
import { mdToHtml } from '../../resources/js/markdown.js';

describe('markdown.js — mdToHtml (escape first, then format)', () => {
    it('renders headings h1-h3', () => {
        const html = mdToHtml('# Jeden\n## Dva\n### Tri');
        expect(html).toContain('>Jeden</h1>');
        expect(html).toContain('>Dva</h2>');
        expect(html).toContain('>Tri</h3>');
    });

    it('renders bullet lists', () => {
        const html = mdToHtml('- prvý\n- druhý');
        expect(html).toContain('<ul');
        expect(html).toContain('<li>prvý</li>');
        expect(html).toContain('<li>druhý</li>');
    });

    it('renders inline code, bold and italic', () => {
        const html = mdToHtml('`kód` a **tučné** a *kurzíva*');
        expect(html).toContain('<code>kód</code>');
        expect(html).toContain('<strong>tučné</strong>');
        expect(html).toContain('<em>kurzíva</em>');
    });

    it('renders fenced code blocks', () => {
        const html = mdToHtml('```\nnpm run build\n```');
        expect(html).toContain('<pre');
        expect(html).toContain('npm run build');
    });

    it('renders a horizontal rule', () => {
        expect(mdToHtml('text\n\n---\n\ntext')).toContain('<hr');
    });

    it('renders frontmatter as a compact meta row', () => {
        const html = mdToHtml('---\narea: dev\nowner: Ucet\n---\n# Titul');
        expect(html).toContain('md-front');
        expect(html).toContain('<strong>area</strong> dev');
    });

    it('escapes HTML before formatting (XSS)', () => {
        const html = mdToHtml('<img src=x onerror="alert(1)">');
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;img');
        expect(html).not.toContain('onerror="');
    });

    it('escapes a script tag hidden inside a list item', () => {
        const html = mdToHtml('- <script>alert(1)</script>');
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('normalises CRLF input', () => {
        expect(mdToHtml('# A\r\n## B')).toContain('>B</h2>');
    });

    it('tolerates empty and non-string input', () => {
        expect(typeof mdToHtml('')).toBe('string');
        expect(typeof mdToHtml(null)).toBe('string');
    });
});
