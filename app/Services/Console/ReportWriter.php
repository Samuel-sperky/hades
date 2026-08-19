<?php

namespace App\Services\Console;

use App\Models\ConsoleReport;
use App\Services\Console\Tools\ToolRefusal;
use DOMDocument;
use DOMElement;
use DOMXPath;
use Illuminate\Support\Str;

/**
 * Zápis reportu, ktorý napísal model, do samostatnej HTML stránky.
 *
 * Prečo vlastný súbor a nie správa vo vlákne: report je výstup, ktorý si človek
 * otvorí, uloží alebo pošle ďalej. V chatovom bubline sa tabuľka na dvadsať
 * riadkov prečítať nedá a odkazom sa poslať nedá vôbec.
 *
 * Markdown je odporúčaný vstup, `html` je únikový ventil pre to, čo si model
 * poskladal z dát sám. Oba idú cez tú istú sanitizáciu — {@see sanitize()}
 * nerozlišuje, odkiaľ HTML prišlo. Markdownu sa veriť NEDÁ: zmerané na
 * `Str::markdown()`, blokový `<script>` síce zaescapuje, ale `<div onclick="…">`
 * prepustí nedotknutý. Vynechať sanitizáciu na markdownovej ceste by teda bola
 * diera veľká presne o jeden atribút.
 */
final class ReportWriter
{
    /** Formáty, v ktorých smie model report napísať. */
    private const FORMATS = ['markdown', 'html'];

    /**
     * Elementy, ktoré sa z reportu vyhadzujú celé (aj s obsahom).
     *
     * `script` je zjavný. `iframe`/`object`/`embed` vedia to isté cez cudzí
     * dokument, `link`/`meta`/`base` prepíšu, odkiaľ sa stránka dopĺňa a kam
     * mieria relatívne odkazy, a `form` vie odoslať POST do appky s cookie
     * človeka. Nič z toho report nepotrebuje.
     */
    private const FORBIDDEN_TAGS = ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form'];

    /** Atribúty, v ktorých môže byť schéma spúšťajúca kód. */
    private const URL_ATTRIBUTES = ['href', 'src'];

    /**
     * Vytvorí report a vráti jeho riadok.
     *
     * @throws ToolRefusal neznámy formát alebo obsah nad stropom
     */
    public function write(string $title, string $content, string $format = 'markdown'): ConsoleReport
    {
        $format = strtolower(trim($format));

        if (! in_array($format, self::FORMATS, true)) {
            throw new ToolRefusal(
                "Unknown report format `{$format}` — use `markdown` (recommended) or `html`."
            );
        }

        $cap = max(1, (int) config('hades.console.reports.cap', 400000));

        if (mb_strlen($content) > $cap) {
            throw new ToolRefusal(
                'Report content is '.mb_strlen($content)." characters, the limit is {$cap}. "
                .'Write a shorter report, or split it into two.'
            );
        }

        $title = trim($title) === '' ? 'Report' : trim($title);

        $body = $format === 'markdown' ? Str::markdown($content) : $content;
        $page = $this->page($title, $this->sanitize($body));

        $report = new ConsoleReport(['title' => $title, 'format' => $format, 'bytes' => strlen($page)]);
        $report->uuid = (string) Str::uuid();

        $path = $report->absolutePath();
        $directory = dirname($path);

        if (! is_dir($directory) && ! @mkdir($directory, 0775, true) && ! is_dir($directory)) {
            throw new ToolRefusal('Cannot create the reports directory — check storage permissions.');
        }

        if (@file_put_contents($path, $page) === false) {
            throw new ToolRefusal('Cannot write the report file — check storage permissions.');
        }

        $report->save();

        $this->prune();

        return $report;
    }

    /**
     * Zahodí všetko, čo v reporte vie spustiť kód alebo siahnuť von.
     *
     * Toto je PRVÁ z DVOCH obranných vrstiev; druhá je `Content-Security-Policy`
     * v `ReportController`. Ani jedna sama nestačí:
     *
     *  - Bez sanitizácie by stačilo, aby CSP raz vypadla (proxy, ktorá hlavičky
     *    prepisuje, `meta` v reporte, staršie WebView) a `<script>` v reporte by
     *    bežal v TOM ISTOM origine ako appka — teda so session cookie človeka a s
     *    prístupom na `/api/nodes`. Report píše MODEL, čiže obsah, ktorý sa dá
     *    ovplyvniť tým, čo model prečítal; treba ho brať ako cudzí vstup.
     *  - Bez CSP by zostala každá diera v tomto parseri (a HTML sanitizácia je
     *    disciplína, v ktorej sa mýlia aj knižnice) priamo zneužiteľná.
     *
     * Vyhadzuje sa: celé elementy zo {@see FORBIDDEN_TAGS}, VŠETKY atribúty
     * začínajúce na `on` (nielen menovaný zoznam — nový `onbeforetoggle` by inak
     * prešiel) a `javascript:` aj `data:text/html` v `href`/`src`.
     */
    private function sanitize(string $html): string
    {
        if (trim($html) === '') {
            return '';
        }

        $dom = new DOMDocument;
        $previous = libxml_use_internal_errors(true);

        // XML prológ je jediný spoľahlivý spôsob, ako libxml povedať, že vstup je
        // UTF-8 (`meta charset` v tele parser prečíta až po tom, čo si vstup už
        // preložil). Bez neho sa slovenská diakritika v reporte rozsype.
        // LIBXML_NONET: parser nesmie počas načítania siahnuť do siete.
        $dom->loadHTML('<?xml encoding="UTF-8"?><html><body>'.$html.'</body></html>', LIBXML_NONET);

        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        $this->stripForbiddenElements($dom);
        $this->stripDangerousAttributes($dom);

        $body = $dom->getElementsByTagName('body')->item(0);

        if ($body === null) {
            return '';
        }

        $out = '';
        foreach ($body->childNodes as $child) {
            $out .= (string) $dom->saveHTML($child);
        }

        return $out;
    }

    private function stripForbiddenElements(DOMDocument $dom): void
    {
        $doomed = [];

        foreach (self::FORBIDDEN_TAGS as $tag) {
            // Najprv zoznam, mazanie až potom: DOMNodeList je ŽIVÝ a mazanie
            // počas iterácie preskočí každý druhý zásah.
            foreach ($dom->getElementsByTagName($tag) as $node) {
                $doomed[] = $node;
            }
        }

        foreach ($doomed as $node) {
            $node->parentNode?->removeChild($node);
        }
    }

    private function stripDangerousAttributes(DOMDocument $dom): void
    {
        $elements = (new DOMXPath($dom))->query('//*');

        if ($elements === false) {
            return;
        }

        foreach ($elements as $element) {
            if (! $element instanceof DOMElement) {
                continue;
            }

            // To isté ako pri elementoch — DOMNamedNodeMap sa pri mazaní preindexuje.
            $names = [];
            foreach ($element->attributes as $attribute) {
                $names[] = $attribute->nodeName;
            }

            foreach ($names as $name) {
                $lower = strtolower($name);

                if (str_starts_with($lower, 'on')) {
                    $element->removeAttribute($name);

                    continue;
                }

                if (in_array($lower, self::URL_ATTRIBUTES, true)
                    && $this->isDangerousUrl($element->getAttribute($name))) {
                    $element->removeAttribute($name);
                }
            }
        }
    }

    /**
     * Schéma, ktorá vie spustiť kód.
     *
     * Biele znaky a riadiace bajty sa najprv vyhodia — `java\nscript:` je starý
     * a stále funkčný trik a porovnanie na surovej hodnote ho prepustí. Entity
     * (`javascript&#58;`) rieši už parser, ten vracia dekódovanú hodnotu.
     */
    private function isDangerousUrl(string $value): bool
    {
        $normalized = strtolower((string) preg_replace('/[\s\x00-\x20\x7f]+/', '', $value));

        return str_starts_with($normalized, 'javascript:')
            || str_starts_with($normalized, 'data:text/html');
    }

    /**
     * Obalí telo do samostatnej stránky.
     *
     * Štýl je inline a farby sú tokeny v `:root` s tmavým variantom cez
     * `prefers-color-scheme` — report sa otvára v prehliadači človeka, nie v
     * appke, takže o téme nič nevie a musí byť čitateľný v oboch. Žiadne externé
     * CDN: report má fungovať aj bez siete a CSP by ho aj tak nepustila.
     */
    private function page(string $title, string $body): string
    {
        $safeTitle = e($title);
        $generated = e(now()->format('j. n. Y H:i'));

        return <<<HTML
        <!DOCTYPE html>
        <html lang="sk">
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>{$safeTitle}</title>
        <style>
        :root {
          color-scheme: light dark;
          --paper: #fbfaf8;
          --ink: #1c1b19;
          --ink-soft: #605c56;
          --rule: #e2ded7;
          --accent: #0f766e;
          --code-bg: #f2efe9;
        }
        @media (prefers-color-scheme: dark) {
          :root {
            --paper: #16171a;
            --ink: #e8e6e1;
            --ink-soft: #a09b93;
            --rule: #2c2e33;
            --accent: #5eead4;
            --code-bg: #1f2126;
          }
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          padding: 2.5rem 1.25rem 5rem;
          background: var(--paper);
          color: var(--ink);
          font-family: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
          font-size: 16px;
          line-height: 1.65;
        }
        .report { max-width: 46rem; margin: 0 auto; }
        .report-head { border-bottom: 1px solid var(--rule); padding-bottom: 1rem; margin-bottom: 2rem; }
        .report-head h1 { margin: 0 0 .35rem; font-size: 1.6rem; line-height: 1.25; letter-spacing: -.01em; }
        .report-meta { margin: 0; color: var(--ink-soft); font-size: .8rem; }
        .report-body > :first-child { margin-top: 0; }
        h1, h2, h3, h4 { line-height: 1.25; margin: 2rem 0 .6rem; }
        h2 { font-size: 1.25rem; }
        h3 { font-size: 1.05rem; }
        p, ul, ol, blockquote, table, pre { margin: 0 0 1rem; }
        a { color: var(--accent); }
        ul, ol { padding-left: 1.4rem; }
        blockquote {
          margin-left: 0;
          padding: .2rem 0 .2rem 1rem;
          border-left: 3px solid var(--rule);
          color: var(--ink-soft);
        }
        code, pre, kbd {
          font-family: "Geist Mono", ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
          font-size: .875em;
        }
        code { background: var(--code-bg); padding: .1em .35em; border-radius: 3px; }
        pre { background: var(--code-bg); padding: .9rem 1rem; border-radius: 6px; overflow-x: auto; }
        pre code { background: none; padding: 0; }
        table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
        th, td { border: 1px solid var(--rule); padding: .4rem .6rem; text-align: left; }
        th { background: var(--code-bg); font-weight: 600; }
        hr { border: 0; border-top: 1px solid var(--rule); margin: 2rem 0; }
        img { max-width: 100%; height: auto; }
        </style>
        </head>
        <body>
        <div class="report">
        <header class="report-head">
        <h1>{$safeTitle}</h1>
        <p class="report-meta">Konzola vedomia · vygenerované {$generated}</p>
        </header>
        <div class="report-body">
        {$body}
        </div>
        </div>
        </body>
        </html>

        HTML;
    }

    /**
     * Nechá na disku len `hades.console.reports.keep` najnovších reportov.
     *
     * Maže sa riadok AJ súbor a v tomto poradí sa to nesmie rozísť: riadok bez
     * súboru je 404 (routa to ustojí), súbor bez riadku je sirota, ktorú už nikdy
     * nikto nezmaže — a presne tie by priečinok nafúkli.
     */
    private function prune(): void
    {
        $keep = max(1, (int) config('hades.console.reports.keep', 100));

        $survivors = ConsoleReport::query()->orderByDesc('id')->limit($keep)->pluck('id');

        ConsoleReport::query()
            ->whereNotIn('id', $survivors)
            ->get()
            ->each(function (ConsoleReport $stale) {
                @unlink($stale->absolutePath());
                $stale->delete();
            });
    }
}
