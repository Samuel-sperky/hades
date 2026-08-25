<?php

namespace App\Http\Controllers\Console;

use App\Http\Controllers\Controller;
use App\Models\ConsoleAttachment;
use App\Models\ConsoleThread;
use App\Services\Console\Attachments;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\ResponseHeaderBag;

/**
 * Prílohy vlákna — nahranie, zoznam, stiahnutie, odobranie zo vstupu.
 *
 * Celý okruh sedí za `auth.ui` + CSRF rovnako ako zvyšok interného `/api/*`
 * (§3.3 docs/BEZPECNOST.md). Nie je to formalita: **appka je verejne tunelovaná
 * cez ngrok**, takže upload je nová útočná plocha a toto je jej hranica.
 *
 * Čo tu na hranici platí a prečo:
 *
 *  - **Whitelist typov, nie blacklist**, a typ sa zisťuje na serveri.
 *    `mimetypes:` v pravidle čítá obsah dočasného súboru (finfo);
 *    `Content-Type` od klienta je tvrdenie, nie fakt. Zoznam je jeden a je
 *    v {@see Attachments}, aby sa hranica a služba nemohli rozísť.
 *  - **Odpoveď na stiahnutie nikdy nedovolí prehliadaču hádať typ.**
 *    `nosniff` + `Content-Disposition: attachment` pre všetko okrem obrázkov +
 *    `Content-Security-Policy: default-src 'none'`. Bez toho by nahraný textový
 *    súbor vedel na našom vlastnom origine bežať ako HTML.
 *  - **Cesta k obsahu sa neskládá z ničoho, čo prišlo v requeste.** Z URL berieme
 *    `uuid`, z riadku `path`, a {@see Attachments::absolutePath()} ho odmietne,
 *    keď vedie mimo priečinka príloh.
 *  - **Zmazať sa dá len rozpracovaná príloha.** Príloha odoslanej správy je
 *    súčasťou histórie a história sa v tomto projekte neprepisuje ani nemaže —
 *    to isté pravidlo, na ktorom stojí vetvenie.
 */
class AttachmentController extends Controller
{
    /**
     * Slovenské hlášky validátora — dôvod je ten istý ako
     * v {@see ThreadController::MESSAGES}: rozhranie má hovoriť jedným jazykom.
     * Tieto sa navyše naozaj čítajú: chybu uploadu vypisuje UI človeku pod
     * vstupom, takže anglická veta validátora by tu trčala.
     *
     * @var array<string, string>
     */
    private const MESSAGES = [
        'file.required' => 'Chýba súbor — nie je čo priložiť.',
        'file.file' => 'Prílohu sa nepodarilo prečítať ako súbor.',
        'file.uploaded' => 'Súbor sa nenahral celý — pravdepodobne presahuje strop servera pre upload.',
        'file.max' => 'Súbor je príliš veľký.',
        'file.mimetypes' => 'Tento typ súboru sa priložiť nedá. Prijímajú sa obrázky, PDF a textové súbory.',
    ];

    /**
     * Prílohy vlákna — rozpracované aj tie, ktoré už patria k správam.
     *
     * Oboje jedným dopytom a v jednej odpovedi: klient potrebuje rozpracované na
     * obnovu vstupu a priradené na vykreslenie bublín, a dva endpointy nad tou
     * istou tabuľkou by sa rozišli v tvare.
     */
    public function index(ConsoleThread $thread): JsonResponse
    {
        // Bez `text_content`: do prehliadača ide STAV, nie obsah (obsah je pre
        // model), a longText dvadsiatich príloh by bol megabajt za nič.
        $attachments = ConsoleAttachment::query()
            ->withTextFlag()
            ->where('thread_id', $thread->id)
            ->orderBy('id')
            ->get();

        return response()->json([
            'attachments' => $attachments->map(fn (ConsoleAttachment $a) => $this->payload($a))->all(),
        ]);
    }

    public function store(Request $request, ConsoleThread $thread, Attachments $attachments): JsonResponse
    {
        // Strop v pravidle je v kilobajtoch a berie sa z tej istej hodnoty, akou
        // sa riadi služba — inak by jedno číslo odmietalo a druhé prijímalo.
        $request->validate([
            'file' => [
                'required',
                'file',
                'max:'.(int) ceil($attachments->maxBytes() / 1024),
                'mimetypes:'.implode(',', $attachments->allowedMimes()),
            ],
        ], self::MESSAGES);

        try {
            $attachment = $attachments->store($thread, $request->file('file'));
        } catch (RuntimeException $e) {
            // Veta zo služby je písaná pre človeka a je to jediná vec, ktorú UI
            // pod vstupom vypíše. Tvar tela je ten istý ako pri validácii, aby
            // klient nemusel mať dve cesty na spracovanie odmietnutia.
            return response()->json([
                'message' => $e->getMessage(),
                'errors' => ['file' => [$e->getMessage()]],
            ], 422);
        }

        return response()->json($this->payload($attachment), 201);
    }

    /**
     * Obsah prílohy.
     *
     * `response()->file()` streamuje zo disku (`BinaryFileResponse`), takže sa
     * celý súbor nikdy nedostane do pamäte jedného z ôsmich PHP workerov — to je
     * ten istý dôvod, prečo obsah nie je v databáze.
     */
    public function show(ConsoleAttachment $attachment, Attachments $attachments): BinaryFileResponse
    {
        $path = $attachments->absolutePath($attachment);

        $response = response()->file($path, [
            // Typ z RIADKU, nie z prípony na disku a nie z requestu. Je to typ,
            // ktorý server sám zistil pri nahraní a ktorý prešiel whitelistom.
            'Content-Type' => $attachment->mime,
            // Bez `nosniff` by prehliadač mohol textový súbor vyhodnotiť ako HTML
            // a spustiť ho na našom origine.
            'X-Content-Type-Options' => 'nosniff',
            // Príloha nemá dôvod načítať ani jeden externý zdroj. Keby sa niekedy
            // do whitelistu dostal typ, ktorý prehliadač vykresľuje, toto je
            // riadok, ktorý z toho nespraví incident.
            'Content-Security-Policy' => "default-src 'none'; sandbox",
        ]);

        // Obrázok sa v chate zobrazuje, takže `inline`; všetko ostatné sa ponúkne
        // na stiahnutie. Meno je `original_name` — to je jediné miesto, kde ho
        // appka používa, a Symfony si k nemu doplní ASCII fallback sám.
        $response->setContentDisposition(
            $attachment->isImage() ? ResponseHeaderBag::DISPOSITION_INLINE : ResponseHeaderBag::DISPOSITION_ATTACHMENT,
            (string) $attachment->original_name,
        );

        // PASCA: `response()->file()` zavolá v konštruktore `setPublic()`, takže
        // `Cache-Control` poslaný v poli hlavičiek by prepísalo `public`. Obsah
        // prílohy nesmie skončiť v zdieľanej cache proxy — appka ide cez Caddy
        // a ngrok — preto sa to prepisuje PO vytvorení odpovede.
        $response->headers->set('Cache-Control', 'private, max-age=0, must-revalidate');

        return $response;
    }

    /**
     * Odobranie prílohy zo vstupu.
     *
     * Súbor sa NEMAŽE — to robí len zametač (`mind:reap-attachments`) a len keď
     * naň neukazuje žiadny riadok. Dôvod je vetvenie: editácia správy skopíruje
     * prílohy ako riadky s tou istou cestou, takže mazanie súboru pri mazaní
     * riadku by zmazaním jednej vetvy vytrhlo prílohu druhej.
     */
    public function destroy(ConsoleAttachment $attachment): JsonResponse
    {
        if ($attachment->message_id !== null) {
            return response()->json([
                'message' => 'Prílohu odoslanej správy sa zmazať nedá — história vlákna sa neprepisuje.',
            ], 422);
        }

        $attachment->delete();

        return response()->json(['deleted' => true]);
    }

    /**
     * Jeden tvar prílohy pre klienta.
     *
     * `text_state` je stav, nie text: obsah prílohy sa do prehliadača neposiela
     * (na to je `url`) a text je pre model, nie pre UI. UI z tohto stavu vykreslí
     * vetu — „text sa nenašiel" je informácia, ktorú človek potrebuje pred tým,
     * než sa modelu opýta na obsah skenovaného PDF.
     *
     * @return array<string, mixed>
     */
    private function payload(ConsoleAttachment $attachment): array
    {
        return [
            'uuid' => $attachment->uuid,
            'message_id' => $attachment->message_id,
            'name' => $attachment->original_name,
            'mime' => $attachment->mime,
            'size_bytes' => (int) $attachment->size_bytes,
            'is_image' => $attachment->isImage(),
            'text_state' => $attachment->textState(),
            // URL sa skladá TU a nie v prehliadači: cesta k obsahu je vec servera
            // (routes/api.php) a klient, ktorý si ju zlepí sám, sa pri prvej zmene
            // route rozíde.
            'url' => url('/api/console/attachments/'.$attachment->uuid),
        ];
    }
}
