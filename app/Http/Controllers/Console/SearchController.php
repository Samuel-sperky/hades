<?php

namespace App\Http\Controllers\Console;

use App\Http\Controllers\Controller;
use App\Models\ConsoleBranch;
use App\Models\ConsoleThread;
use App\Serializers\Screen\ChatScreen;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Validator;

/**
 * Hľadanie v histórii chatu a export vlákna do markdownu.
 *
 * Kontrolér sám nič neskládá: tvar odpovede aj text exportu drží
 * {@see ChatScreen} — tá istá trieda, z ktorej má čítať MCP tool. To je celý
 * zmysel dvojitej plochy; keby si kontrolér skládal odpoveď sám, plochy by sa
 * rozišli pri prvej zmene obrazovky.
 *
 * Oba endpointy sú **len na čítanie** a sedia v tom istom guardovanom okruhu
 * (`auth.ui` + CSRF) ako zvyšok interného `/api/*`. Nie je to formalita:
 * hľadanie čítá naprieč VŠETKÝMI vláknami, takže je to najširšie čítanie
 * konverzačnej pamäte, aké appka má — širšie než `GET /api/console/threads/{uuid}`.
 */
class SearchController extends Controller
{
    /**
     * Slovenské hlášky validátora — ten istý dôvod ako
     * {@see ThreadController::MESSAGES}: rozhranie má hovoriť jedným jazykom
     * a validátor bez tohto poľa vracia anglickú vetu.
     *
     * @var array<string, string>
     */
    private const MESSAGES = [
        'q.required' => 'Napíš, čo hľadať.',
        'q.string' => 'Hľadaný text musí byť text.',
        'q.min' => 'Hľadaný text musí mať aspoň dva znaky.',
        'q.max' => 'Hľadaný text presahuje 200 znakov.',
        'thread.uuid' => 'Identifikátor vlákna nemá platný tvar.',
        'project.uuid' => 'Identifikátor projektu nemá platný tvar.',
        'branch.uuid' => 'Identifikátor vetvy nemá platný tvar.',
        'role.in' => 'Filtrovať sa dá len na moje správy alebo na odpovede Charóna.',
        'from.date' => 'Dátum „od" nemá platný tvar.',
        'to.date' => 'Dátum „do" nemá platný tvar.',
        'limit.integer' => 'Počet výsledkov musí byť číslo.',
        'limit.min' => 'Počet výsledkov musí byť aspoň 1.',
        'limit.max' => 'Počet výsledkov presahuje strop.',
    ];

    /**
     * `GET /api/console/search` — fulltext v `console_messages` naprieč vláknami.
     *
     * Dopyt je povinný a má strop na dva znaky. Jednoznakový dopyt vráti prakticky
     * celú konverzačnú históriu appky, čo nie je hľadanie, ale export omylom.
     */
    public function index(Request $request): JsonResponse
    {
        $validator = Validator::make($request->query(), [
            'q' => 'required|string|min:'.ChatScreen::MIN_QUERY.'|max:200',
            'thread' => 'sometimes|nullable|uuid',
            'project' => 'sometimes|nullable|uuid',
            'role' => 'sometimes|nullable|string|in:user,assistant',
            'from' => 'sometimes|nullable|date',
            'to' => 'sometimes|nullable|date',
            'limit' => 'sometimes|nullable|integer|min:1|max:'.ChatScreen::MAX_LIMIT,
        ], self::MESSAGES);

        if ($validator->fails()) {
            return response()->json(['message' => $validator->errors()->first()], 422);
        }

        return response()->json((new ChatScreen($validator->validated()))->data());
    }

    /**
     * `GET /api/console/threads/{thread:uuid}/export` — vlákno ako markdown.
     *
     * Odpoveď je `text/markdown`, nie JSON s markdownom vnútri: prehliadač aj
     * `curl` z toho majú rovno súbor a nikto ho nemusí rozbaľovať z JSON stringu.
     *
     * `?branch=<uuid>` exportuje inú než aktívnu vetvu. Vetva sa hľadá **vnútri
     * vlákna** (`$thread->branches()`), takže uuid z cudzieho vlákna je 404, nie
     * cudzia konverzácia v odpovedi. Kontrolu robíme tu, pretože cudzí kľúč ju
     * vyjadriť nevie — `active_branch_id` je bez FK a to je zámer, nie diera
     * (viď {@see ConsoleThread::currentBranch()}).
     */
    public function export(Request $request, ConsoleThread $thread): Response
    {
        $validator = Validator::make($request->query(), [
            'branch' => 'sometimes|nullable|uuid',
        ], self::MESSAGES);

        if ($validator->fails()) {
            return response($validator->errors()->first(), 422)
                ->header('Content-Type', 'text/plain; charset=utf-8');
        }

        $branch = null;

        if (($uuid = (string) $request->query('branch', '')) !== '') {
            $branch = $thread->branches()->where('uuid', $uuid)->first();

            if (! $branch instanceof ConsoleBranch) {
                return response('Taká vetva v tomto vlákne nie je.', 404)
                    ->header('Content-Type', 'text/plain; charset=utf-8');
            }
        }

        $markdown = ChatScreen::markdown($thread, $branch);

        return response($markdown, 200, [
            'Content-Type' => 'text/markdown; charset=utf-8',
            // Meno stavia `ChatScreen::exportName()` zo slugu, takže v hlavičke
            // nemôže skončiť lomka, uvozovka ani nový riadok z názvu vlákna.
            'Content-Disposition' => 'attachment; filename="'.ChatScreen::exportName($thread).'"',
        ]);
    }
}
