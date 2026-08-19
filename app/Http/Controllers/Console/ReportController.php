<?php

namespace App\Http\Controllers\Console;

use App\Http\Controllers\Controller;
use App\Models\ConsoleReport;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Str;

/**
 * Servírovanie reportu, ktorý napísal model.
 *
 * Routa sedí pod `auth.ui` rovnako ako zvyšok konzoly — report je výstup nad
 * pamäťou, takže nie je menej citlivý než `GET /api/mind`.
 *
 * Hlavičky tu nie sú kozmetika. Report sa servuje z TOHO ISTÉHO origine ako
 * appka, takže čokoľvek, čo by v ňom bežalo, by malo session cookie človeka.
 * CSP je preto druhá obranná vrstva k sanitizácii v
 * `ReportWriter::sanitize()`: `default-src 'none'` znamená, že stránka nesmie
 * načítať ani spustiť NIČ okrem toho, čo je tu
 * menovite povolené — inline štýl (report je jeden súbor bez assetov), obrázky
 * ako `data:` a fonty z vlastného origine. Skript teda nebeží ani vtedy, keď sa
 * do tela nejakou cestou dostane.
 */
class ReportController extends Controller
{
    public function show(Request $request, ConsoleReport $report): Response
    {
        $path = $report->absolutePath();

        // Riadok bez súboru je normálny stav, nie porucha: `ReportWriter::prune()`
        // maže staré reporty a niekto môže priečinok vyčistiť ručne. 500 by z toho
        // urobila hlásenú chybu a zaplnila log niečím, čo sa nedá opraviť.
        if (! is_file($path)) {
            abort(404);
        }

        $content = (string) file_get_contents($path);

        return response($content, 200, [
            'Content-Type' => 'text/html; charset=utf-8',
            'Content-Security-Policy' => implode('; ', [
                "default-src 'none'",
                "style-src 'unsafe-inline'",
                'img-src data:',
                "font-src 'self'",
                "base-uri 'none'",
                "form-action 'none'",
            ]),
            // Bez nosniff by prehliadač smel typ prehlasovať; pri obsahu, ktorý
            // napísal model, je hádanie typu presne to, čo nechceme.
            'X-Content-Type-Options' => 'nosniff',
            'Content-Disposition' => $this->disposition($request, $report),
        ]);
    }

    /**
     * `?download=1` pošle report ako súbor — človek si ho odloží alebo priloží
     * do mailu. Inak sa otvorí v prehliadači, čo je bežný prípad.
     */
    private function disposition(Request $request, ConsoleReport $report): string
    {
        if (! $request->boolean('download')) {
            return 'inline';
        }

        // Meno súboru z titulku, nie z uuid: „stav-testov.html" povie človeku v
        // priečinku Downloads viac než 36 náhodných znakov. Slug zároveň zabíja
        // úvodzovky a lomky, ktorými sa hlavička dá rozbiť.
        $name = Str::slug($report->title);
        $name = $name === '' ? $report->uuid : Str::limit($name, 60, '');

        return 'attachment; filename="'.$name.'.html"';
    }
}
