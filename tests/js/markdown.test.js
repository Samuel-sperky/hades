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

describe('markdown.js — P6 extensions', () => {
    it('renders h4 by default and respects headingDepth', () => {
        expect(mdToHtml('#### Štyri')).toContain('>Štyri</h4>');
        expect(mdToHtml('#### Štyri', { headingDepth: 3 })).not.toContain('<h4');
    });

    it('renders ordered lists as <ol>', () => {
        const html = mdToHtml('1. prvý\n2. druhý');
        expect(html).toContain('<ol');
        expect(html).toContain('<li>prvý</li>');
        expect(html).toContain('<li>druhý</li>');
    });

    it('does not merge an ordered list into a bullet list', () => {
        const html = mdToHtml('- a\n1. b');
        expect(html).toContain('</ul><ol');
    });

    it('renders blockquotes', () => {
        const html = mdToHtml('> citát na dvoch\n> riadkoch');
        expect(html).toContain('<blockquote class="md-quote">');
        expect(html).toContain('citát na dvoch riadkoch');
    });

    it('renders GFM pipe tables with alignment', () => {
        const html = mdToHtml('| Model | tok/s |\n| --- | ---: |\n| qwen3:4b | 12 |');
        expect(html).toContain('<table class="md-table">');
        expect(html).toContain('<th>Model</th>');
        expect(html).toContain('text-align:right');
        expect(html).toContain('qwen3:4b');
    });

    it('leaves a lone pipe line as a paragraph (no table without a rule row)', () => {
        expect(mdToHtml('a | b')).not.toContain('<table');
    });

    it('renders markdown links with rel/noopener', () => {
        const html = mdToHtml('[Ollama](https://ollama.com/library)');
        expect(html).toContain('href="https://ollama.com/library"');
        expect(html).toContain('rel="noopener noreferrer"');
        expect(html).toContain('>Ollama</a>');
    });

    it('autolinks bare http(s) URLs and keeps trailing punctuation outside', () => {
        const html = mdToHtml('Pozri http://localhost:8082/api/mind.');
        expect(html).toContain('href="http://localhost:8082/api/mind"');
        expect(html).toMatch(/<\/a>\.\s*<\/p>|<\/a>\./);
    });

    it('refuses javascript: and data: URLs (renders them as text)', () => {
        const js = mdToHtml('[klik](javascript:alert(1))');
        expect(js).not.toContain('href=');
        expect(js).not.toContain('<a ');
        const data = mdToHtml('[klik](data:text/html,<script>alert(1)</script>)');
        expect(data).not.toContain('<a ');
    });

    it('allows relative and mailto links', () => {
        expect(mdToHtml('[uzol](/api/mind)')).toContain('href="/api/mind"');
        expect(mdToHtml('[mail](mailto:a@b.sk)')).toContain('href="mailto:a@b.sk"');
    });

    it('does not linkify inside inline code', () => {
        const html = mdToHtml('`https://example.com`');
        expect(html).toContain('<code>https://example.com</code>');
        expect(html).not.toContain('<a ');
    });

    it('adds a copy button to code blocks only when asked', () => {
        expect(mdToHtml('```\nls\n```')).not.toContain('md-copy');
        const html = mdToHtml('```\nls\n```', { codeCopyButton: true });
        expect(html).toContain('class="md-copy ms"');
        expect(html).toContain('aria-label="Kopírovať kód"');
    });

    it('can switch extensions off', () => {
        expect(mdToHtml('| a | b |\n| - | - |\n| 1 | 2 |', { tables: false })).not.toContain('<table');
        expect(mdToHtml('> x', { blockquote: false })).not.toContain('<blockquote');
        expect(mdToHtml('1. x', { orderedLists: false })).not.toContain('<ol');
        expect(mdToHtml('[a](https://b.sk)', { links: false })).not.toContain('<a ');
    });

    it('strips NUL sentinels smuggled in the source', () => {
        const html = mdToHtml('a' + String.fromCharCode(0) + '0' + String.fromCharCode(0) + 'b');
        expect(html).toContain('a0b');
    });
});
