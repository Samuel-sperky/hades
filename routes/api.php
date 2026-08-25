<?php

use App\Http\Controllers\ActivationController;
use App\Http\Controllers\Api\DecisionController;
use App\Http\Controllers\Api\GraphController as ApiGraphController;
use App\Http\Controllers\Api\HealthController;
use App\Http\Controllers\Api\KnowledgeController;
use App\Http\Controllers\Api\ReviewController;
use App\Http\Controllers\Api\SearchController as ApiSearchController;
use App\Http\Controllers\Api\StatsController;
use App\Http\Controllers\Api\SyncController;
use App\Http\Controllers\Console\AttachmentController as ConsoleAttachmentController;
use App\Http\Controllers\Console\BranchController as ConsoleBranchController;
use App\Http\Controllers\Console\ModelController as ConsoleModelController;
use App\Http\Controllers\Console\ProjectController as ConsoleProjectController;
use App\Http\Controllers\Console\RunController as ConsoleRunController;
use App\Http\Controllers\Console\SearchController as ConsoleSearchController;
use App\Http\Controllers\Console\ThreadController as ConsoleThreadController;
use App\Http\Controllers\ContextController;
use App\Http\Controllers\DirectiveController;
use App\Http\Controllers\EdgeController;
use App\Http\Controllers\LibraryController;
use App\Http\Controllers\MaintenanceController;
use App\Http\Controllers\MindController;
use App\Http\Controllers\NodeController;
use App\Http\Controllers\RunsController;
use App\Http\Controllers\SearchController;
use App\Http\Controllers\StructureController;
use App\Http\Controllers\TodayController;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Route;

// ---------------------------------------------------------------------------
// Interné /api/* pre SPA (dashboard, graf, Charón) — §4.3 kontraktu: SPA nikdy
// nedrží token. Od 13. 8. 2026 sú za UI guardom (AuthenticateUi) — dovtedy ich
// nechránilo nič okrem bindingu na 127.0.0.1:8080, takže ktorýkoľvek lokálny
// proces vedel čítať aj prepisovať celú pamäť (§8.1 docs/BEZPECNOST.md).
//
// Middleware je vypísaný ručne a nie ako group 'web' zámerne, kvôli poradiu:
// cookies → session → guard → CSRF. Pri 'web' by CSRF bežal PRED guardom a
// nezamknutý zápis by vracal 419 namiesto 401. Zo zvyšku 'web' tu nič netreba
// (ShareErrorsFromSession je pre view chyby, SubstituteBindings dáva 'api').
//
// Dôsledok pre programatických klientov: interné /api/* je odteraz cesta pre
// prehliadač (session + CSRF). Skripty a integrácie patria na /api/v1/* s
// Bearer tokenom — ten CSRF nemá a mať nemusí.
// ---------------------------------------------------------------------------
Route::middleware([
    EncryptCookies::class,
    StartSession::class,
    'auth.ui',
    ValidateCsrfToken::class,
])->group(function (): void {
    Route::get('/mind', [MindController::class, 'graph']);
    Route::get('/mind/stats', [MindController::class, 'stats']);
    Route::get('/journal', [\App\Http\Controllers\JournalController::class, 'index']);

    // Obrazovky redizajnu: Dnes / Knižnica + export balíka do schránky
    Route::get('/today', [TodayController::class, 'index']);
    Route::get('/library', [LibraryController::class, 'index']);
    Route::post('/context/pack', [ContextController::class, 'pack']);

    // Smernica pre Claude — prompt builder (KDE ČO NÁJDE: skilly, projekty, fakty, pravidlá)
    Route::post('/directive/build', [DirectiveController::class, 'build']);
    Route::post('/directive/save', [DirectiveController::class, 'save']);
    Route::get('/directive/templates', [DirectiveController::class, 'templates']);
    Route::get('/directive/{name}', [DirectiveController::class, 'show']);
    // Mazanie uloženej smernice — bez neho vedela sekcia „Uložené smernice" len rásť.
    Route::delete('/directive/{name}', [DirectiveController::class, 'destroy']);
    Route::get('/directives', [DirectiveController::class, 'index']);

    Route::post('/nodes', [NodeController::class, 'store']);
    Route::get('/nodes/{node}/suggestions', [NodeController::class, 'suggestions']);
    Route::get('/nodes/{node}/markdown', [NodeController::class, 'markdown']);
    Route::get('/nodes/{node}', [NodeController::class, 'show']);
    Route::put('/nodes/{node}', [NodeController::class, 'update']);
    Route::delete('/nodes/{node}', [NodeController::class, 'destroy']);

    Route::post('/edges', [EdgeController::class, 'store']);
    Route::delete('/edges/{edge}', [EdgeController::class, 'destroy']);

    Route::get('/activations', [ActivationController::class, 'index']);

    // A9: mŕtvy chat nad grafom (POST /chat → ChatController@send cez Anthropic)
    // je odpojený. Nahradil ho dok Charóna nad plátnom (/api/console/run, nižšie),
    // ktorý beží lokálne a nesie dvojfázovú bránu zápisov. ChatController zostáva
    // ako referenčná implementácia volania SDK (viď AnthropicProvider @see), ale
    // nevedie k nemu žiadna route ani UI.

    // Foldering / štruktúra vedomia
    Route::get('/structure', [StructureController::class, 'index']);
    Route::put('/departments/{department}', [StructureController::class, 'updateDepartment']);
    Route::delete('/departments/{department}', [StructureController::class, 'destroyDepartment']);

    // Vyhľadávanie naprieč uzlami a playbookmi
    Route::get('/search', [SearchController::class, 'index']);

    // Údržba — duplicity a zlučovanie uzlov
    Route::get('/duplicates', [MaintenanceController::class, 'duplicates']);
    Route::post('/nodes/{node}/merge/{target}', [MaintenanceController::class, 'merge']);

    // Zdieľané controllery s v1: SPA volá tie isté, len bez Bearer tokenu.
    Route::get('/dashboard', [StatsController::class, 'index']);       // = /api/v1/stats
    Route::post('/sync', [SyncController::class, 'store']);            // lock → 423
    Route::get('/decisions', [DecisionController::class, 'index']);
    Route::post('/decisions', [DecisionController::class, 'store']);   // §4.7 aj pri guard OFF
    // Oprava zle zapísaného rozhodnutia. Zámerne LEN v internom (UI) okruhu:
    // `/api/v1/decisions` je kontrakt pre skripty a mazanie pamäte na Bearer token
    // je väčšia plocha, než akú tento nález žiada.
    Route::delete('/decisions/{decision}', [DecisionController::class, 'destroy']);
    Route::get('/tags', [KnowledgeController::class, 'tags']);

    // Kontrola — verify/review fronta (B5).
    Route::get('/review/queue', [ReviewController::class, 'queue']);
    // Sekcia „Hygiena" tej istej obrazovky (A3) — ten istý serializér kŕmi
    // `mind_hygiene`, takže odpad, ktorý vidí AI, vidí odteraz aj človek.
    //
    // `throttle` je tu naozaj potrebný, nie z opatrnosti: každé volanie spustí
    // `mind:hygiene`, teda prechod celou sieťou (uzly + hrany) VNÚTRI HTTP
    // requestu, a PHP workerov je osem. Obrana v prehliadači (`hygienaState`)
    // chráni pred klikaním, nie pred volaním endpointu priamo.
    Route::get('/hygiene', [ReviewController::class, 'hygiene'])->middleware('throttle:6,1');
    Route::post('/nodes/{node}/verify', [ReviewController::class, 'verify']);
    Route::post('/nodes/{node}/resolve-review', [ReviewController::class, 'resolveReview']);

    // -----------------------------------------------------------------------
    // Charón — vlákna a agentový beh. Zámerne v TOM ISTOM guardovanom
    // okruhu ako zvyšok interného API: tooly konzoly vedia zapisovať do pamäte
    // aj do súborov, takže vlastný, voľnejší okruh by bol obchádzka guardu.
    //
    // Beh je dvojfázový a všetko ide POST-om: `run` vráti stream a skončí buď
    // hotovou odpoveďou, alebo stavom „čakám na povolenie"; `decide` rozhodne o
    // jednom tool calle a beh pokračuje. Preto tu nie je GET SSE endpoint —
    // EventSource nevie poslať CSRF hlavičku a GET stream by musel z okruhu
    // vypadnúť. `fetch` so čítaním tela to zvládne s CSRF aj so `stop`.
    // -----------------------------------------------------------------------
    // Ponuka modelov pre prepínač. GET a bez throttle: číta sa raz pri načítaní
    // konzoly a je to len zoznam mien od poskytovateľa.
    Route::get('/console/models', [ConsoleModelController::class, 'index']);

    Route::get('/console/threads', [ConsoleThreadController::class, 'index']);
    Route::post('/console/threads', [ConsoleThreadController::class, 'store']);
    Route::get('/console/threads/{thread:uuid}', [ConsoleThreadController::class, 'show']);
    Route::patch('/console/threads/{thread:uuid}', [ConsoleThreadController::class, 'update']);
    Route::delete('/console/threads/{thread:uuid}', [ConsoleThreadController::class, 'destroy']);

    // -----------------------------------------------------------------------
    // Projekty (zložky vlákien) a vetvy konverzácie — `/chat`.
    //
    // Zaradenie vlákna do projektu je route PROJEKTU, nie vlákna: vlákno patrí
    // najviac do jedného projektu, takže vzťah vlastní projekt a `PATCH` vlákna
    // zostáva o vlákne samom (model, titulok, brána zápisov).
    //
    // Vetvenie tu KONČÍ pri zápise do `console_branches` a prepnutí aktívnej
    // vetvy. Upravenú správu zapíše bežný beh cez `/console/run` — vetvenie sa
    // nesmie stať druhým pisateľom do `console_messages` vedľa `AgentRunner`a.
    // -----------------------------------------------------------------------
    Route::get('/console/projects', [ConsoleProjectController::class, 'index']);
    Route::post('/console/projects', [ConsoleProjectController::class, 'store']);
    Route::get('/console/projects/{project:uuid}', [ConsoleProjectController::class, 'show']);
    Route::patch('/console/projects/{project:uuid}', [ConsoleProjectController::class, 'update']);
    Route::delete('/console/projects/{project:uuid}', [ConsoleProjectController::class, 'destroy']);
    Route::post('/console/projects/{project:uuid}/threads', [ConsoleProjectController::class, 'attach']);
    Route::delete('/console/projects/{project:uuid}/threads/{thread:uuid}', [ConsoleProjectController::class, 'detach']);

    Route::get('/console/threads/{thread:uuid}/branches', [ConsoleBranchController::class, 'index']);
    Route::post('/console/threads/{thread:uuid}/branches', [ConsoleBranchController::class, 'store']);
    Route::post('/console/branches/{branch:uuid}/activate', [ConsoleBranchController::class, 'activate']);
    Route::delete('/console/branches/{branch:uuid}', [ConsoleBranchController::class, 'destroy']);

    // Prílohy vlákna. `throttle` je na uploade zámerne: `store()` prijíma súbor od
    // človeka, ukladá ho na disk a pri PDF z neho ťahá text — teda jeden request
    // robí veľa práce, a appka je verejne tunelovaná cez ngrok.
    //
    // `show()` je binárny výdaj a NIE JE pod throttlom: náhľady obrázkov v toku by
    // ho vyčerpali pri prvom otvorení dlhšieho vlákna.
    Route::get('/console/threads/{thread:uuid}/attachments', [ConsoleAttachmentController::class, 'index']);
    Route::post('/console/threads/{thread:uuid}/attachments', [ConsoleAttachmentController::class, 'store'])
        ->middleware('throttle:20,1');
    Route::get('/console/attachments/{attachment:uuid}', [ConsoleAttachmentController::class, 'show']);
    Route::delete('/console/attachments/{attachment:uuid}', [ConsoleAttachmentController::class, 'destroy']);

    // Hľadanie v histórii naprieč vláknami a export vlákna do markdownu. Export je
    // GET, pretože je to čítanie — a skládá ho SERVER, aby všetky tri plochy
    // (konzola, dok, /chat) dostali ten istý text. Systémová smernica v ňom nie je.
    // `throttle` z toho istého dôvodu ako pri `/hygiene`: jeden request je
    // `LOWER(content) LIKE '%…%'` nad celou tabuľkou správ, teda plný sken bez
    // indexu, a PHP workerov je osem.
    Route::get('/console/search', [ConsoleSearchController::class, 'index'])
        ->middleware('throttle:30,1');
    Route::get('/console/threads/{thread:uuid}/export', [ConsoleSearchController::class, 'export']);

    // Beh agenta. Throttle je na `run`, nie na `decide`: jeden ťah drží spojenie
    // minúty a dvadsať za minútu je strop, ktorý §8.9 docs/BEZPECNOST.md už
    // sľubuje. `decide` je klik človeka v rozbehnutom behu — obmedziť ho na 20
    // by znamenalo, že sa v dlhom vlákne nedá dopovoliť vlastný zápis.
    Route::post('/console/run', [ConsoleRunController::class, 'run'])->middleware('throttle:20,1');
    Route::post('/console/decide', [ConsoleRunController::class, 'decide']);

    // -----------------------------------------------------------------------
    // Log behov — obrazovka Runy. Len na čítanie; „spustiť znovu" vracia zadanie
    // a nový ťah spustí klient cez `/console/run`, aby nevznikla druhá cesta
    // k modelu, ktorá obchádza dvojfázovú bránu.
    //
    // Tvar odpovede drží `App\Serializers\Screen\Runs*Screen` — tie isté triedy
    // čítajú MCP tooly `mind_runs` a `mind_run`.
    // -----------------------------------------------------------------------
    Route::get('/runs', [RunsController::class, 'index']);
    Route::get('/runs/{uuid}', [RunsController::class, 'show']);
    Route::post('/runs/{uuid}/rerun', [RunsController::class, 'rerun']);
});

// ---------------------------------------------------------------------------
// Externé /api/v1/* — programatický mirror. Health bez tokenu, zvyšok
// auth.token (Bearer, fail-closed). Rovnaké controllery ako interné.
// Bez session a bez CSRF: stateless klient, ktorý drží token.
// ---------------------------------------------------------------------------
Route::prefix('v1')->group(function (): void {
    Route::get('/health', [HealthController::class, 'index']);

    Route::middleware('auth.token')->group(function (): void {
        Route::get('/knowledge', [KnowledgeController::class, 'index']);
        Route::post('/knowledge', [KnowledgeController::class, 'store']);
        Route::get('/knowledge/{node}', [KnowledgeController::class, 'show']);
        Route::put('/knowledge/{node}', [KnowledgeController::class, 'update']);
        Route::delete('/knowledge/{node}', [KnowledgeController::class, 'destroy']);

        Route::get('/graph', [ApiGraphController::class, 'index']);
        Route::get('/search', [ApiSearchController::class, 'index']);
        Route::get('/stats', [StatsController::class, 'index']);
        Route::post('/sync', [SyncController::class, 'store']);

        Route::get('/decisions', [DecisionController::class, 'index']);
        Route::post('/decisions', [DecisionController::class, 'store']);
        Route::get('/tags', [KnowledgeController::class, 'tags']);

        // Kontrola — verify/review fronta (B5), externý mirror.
        Route::get('/review/queue', [ReviewController::class, 'queue']);
        Route::post('/nodes/{node}/verify', [ReviewController::class, 'verify']);
        Route::post('/nodes/{node}/resolve-review', [ReviewController::class, 'resolveReview']);
    });
});
