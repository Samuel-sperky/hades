<?php

namespace App\Http\Controllers\Console;

use App\Http\Controllers\Controller;
use App\Models\ConsoleProject;
use App\Models\ConsoleThread;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Projekty (zložky vlákien) — zoznam, založenie, premenovanie, pripnutie,
 * archivácia, zmazanie, a zaradenie vlákna do projektu.
 *
 * Celý okruh sedí za `auth.ui` + CSRF rovnako ako zvyšok interného `/api/*`:
 * zoznam projektov je mapa toho, o čom človek s modelom hovorí, a to nie je
 * menej citlivé než samotné vlákna.
 *
 * **Zaradenie vlákna je tu, nie v `ThreadController`e.** Vlákno patrí najviac do
 * JEDNÉHO projektu, takže zaradenie je zápis jedného stĺpca (`project_id`) a
 * projekt je tá strana, ktorá vzťah vlastní; `PATCH` vlákna zostáva o vlákne
 * samom (model, titulok, brána zápisov).
 *
 * **Počet vlákien sa počíta v SQL** — jedným agregačným dopytom vedľa zoznamu,
 * nie z denormalizovaného stĺpca a nie z toho, čo si klient práve načítal. Presne
 * tú chybu našiel audit 19. 8. 2026: čip sľuboval číslo, ktoré zoznam nedal.
 * Číslo znamená **neodložené** vlákna projektu (archivované sa nepočítajú, lebo
 * ich panel nevypisuje).
 */
class ProjectController extends Controller
{
    /**
     * Slovenské hlášky validátora — dôvod je ten istý ako v
     * {@see RunController::MESSAGES}: rozhranie má hovoriť jedným jazykom a
     * validátor bez tohto poľa vracia anglickú vetu.
     *
     * @var array<string, string>
     */
    private const MESSAGES = [
        'name.required' => 'Projekt potrebuje názov.',
        'name.string' => 'Názov projektu musí byť text.',
        'name.max' => 'Názov projektu presahuje 120 znakov.',
        'pinned.boolean' => 'Pripnutie projektu musí byť áno alebo nie.',
        'archived.boolean' => 'Archivácia projektu musí byť áno alebo nie.',
        'thread.required' => 'Chýba vlákno, ktoré sa má zaradiť.',
        'thread.uuid' => 'Identifikátor vlákna nemá platný tvar.',
    ];

    /**
     * Zoznam pre bočný panel. Číta sa **celý** (projektov sú jednotky až
     * desiatky), preto tabuľka nemá index a preto sa tu nefiltruje na serveri:
     * archivované idú v odpovedi tiež, len sú označené — panel ich schová a
     * sekcia „Archív" ich ukáže bez druhého requestu.
     */
    public function index(): JsonResponse
    {
        $counts = ConsoleThread::query()
            ->whereNotNull('project_id')
            ->whereNull('archived_at')
            ->selectRaw('project_id, COUNT(*) as threads')
            ->groupBy('project_id')
            ->pluck('threads', 'project_id');

        $projects = ConsoleProject::query()
            ->forPanel()
            ->get()
            ->map(fn (ConsoleProject $p) => $this->payload($p, (int) ($counts[$p->id] ?? 0)));

        return response()->json(['projects' => $projects]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => 'required|string|max:120',
        ], self::MESSAGES);

        // Bez kontroly na duplicitný názov: dva projekty s tým istým menom sú
        // neporiadok, nie chyba dát, a odmietnuté uloženie by človeka zastavilo
        // pri práci (to isté rozhodnutie ako `name` bez `unique` v migrácii).
        $project = ConsoleProject::create(['name' => trim($data['name'])]);

        return response()->json($this->payload($project, 0), 201);
    }

    public function show(ConsoleProject $project): JsonResponse
    {
        return response()->json([
            'project' => $this->payload($project, $this->threadCount($project)),
            'threads' => $this->threads($project),
        ]);
    }

    /**
     * Premenovanie, pripnutie a archivácia v jednom `PATCH`i.
     *
     * `pinned` / `archived` prichádzajú ako boolean a do DB sa píše **timestamp**:
     * `null` = nepripnuté, dátum navyše nesie poradie pripnutých. Klient tak
     * nemusí posielať čas a server nemusí veriť tomu, ktorý mu pošle.
     */
    public function update(Request $request, ConsoleProject $project): JsonResponse
    {
        $data = $request->validate([
            'name' => 'sometimes|required|string|max:120',
            'pinned' => 'sometimes|boolean',
            'archived' => 'sometimes|boolean',
        ], self::MESSAGES);

        if (array_key_exists('name', $data)) {
            $project->name = trim($data['name']);
        }

        // Opakované pripnutie čas NEPREPISUJE: poradie pripnutých je poradie
        // pripnutia, nie poradie posledného kliku na už pripnutý projekt.
        if (array_key_exists('pinned', $data)) {
            $project->pinned_at = $data['pinned'] ? ($project->pinned_at ?? now()) : null;
        }

        if (array_key_exists('archived', $data)) {
            $project->archived_at = $data['archived'] ? ($project->archived_at ?? now()) : null;
        }

        $project->save();

        return response()->json($this->payload($project, $this->threadCount($project)));
    }

    /**
     * Zmazanie projektu **vlákna vysype, nespáli** — cudzí kľúč je `nullOnDelete`,
     * takže konverzácie žijú ďalej s `project_id = null`. S kaskádou by jeden klik
     * „zmazať zložku" zmazal všetky konverzácie v nej.
     */
    public function destroy(ConsoleProject $project): JsonResponse
    {
        $project->delete();

        return response()->json(['deleted' => true]);
    }

    /** Zaradenie vlákna do projektu — jeden stĺpec, takže „najviac jeden" drží schéma. */
    public function attach(Request $request, ConsoleProject $project): JsonResponse
    {
        $data = $request->validate([
            'thread' => 'required|uuid',
        ], self::MESSAGES);

        $thread = ConsoleThread::where('uuid', $data['thread'])->first();

        if ($thread === null) {
            return response()->json(['message' => 'Také vlákno neexistuje.'], 404);
        }

        $thread->project_id = $project->id;
        $thread->save();

        return response()->json(['project' => $project->uuid, 'thread' => $thread->uuid]);
    }

    /**
     * Vyradenie vlákna z projektu. Vlastná route a nie `attach` s `null`om:
     * „vyhoď zo zložky" je iná operácia než „presuň do zložky" a nemá sa dať
     * spustiť zabudnutým poľom v tele requestu.
     */
    public function detach(ConsoleProject $project, ConsoleThread $thread): JsonResponse
    {
        // Vlákno z INÉHO projektu sa nevyradí: id v ceste by inak dovolilo
        // odpojiť čokoľvek pod hlavičkou ľubovoľného projektu.
        if ($thread->project_id !== $project->id) {
            return response()->json(['message' => 'Toto vlákno v tomto projekte nie je.'], 404);
        }

        $thread->project_id = null;
        $thread->save();

        return response()->json(['detached' => true]);
    }

    /** @return array<string, mixed> */
    private function payload(ConsoleProject $project, int $threads): array
    {
        return [
            'uuid' => $project->uuid,
            'name' => $project->name,
            'pinned' => $project->isPinned(),
            'archived' => $project->isArchived(),
            'pinned_at' => $project->pinned_at?->toIso8601String(),
            'archived_at' => $project->archived_at?->toIso8601String(),
            'threads' => $threads,
        ];
    }

    private function threadCount(ConsoleProject $project): int
    {
        return $project->threads()->whereNull('archived_at')->count();
    }

    /**
     * Vlákna projektu pre jeho detail. Dopyt je presne ten, na ktorý je zložený
     * index `['project_id', 'last_message_at']` — filter aj radenie v jednom.
     *
     * @return array<int, array<string, mixed>>
     */
    private function threads(ConsoleProject $project): array
    {
        return $project->threads()
            ->orderByDesc('last_message_at')
            ->orderByDesc('id')
            ->limit(100)
            ->get(['uuid', 'title', 'last_message_at', 'pinned_at', 'archived_at'])
            ->map(fn (ConsoleThread $t) => [
                'uuid' => $t->uuid,
                'title' => $t->title ?? 'Nové vlákno',
                'last_message_at' => $t->last_message_at?->toIso8601String(),
                'pinned' => $t->pinned_at !== null,
                'archived' => $t->archived_at !== null,
            ])
            ->all();
    }
}
