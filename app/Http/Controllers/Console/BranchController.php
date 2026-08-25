<?php

namespace App\Http\Controllers\Console;

use App\Http\Controllers\Controller;
use App\Models\ConsoleBranch;
use App\Models\ConsoleMessage;
use App\Models\ConsoleThread;
use App\Models\Run;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Vetvy vlákna — zoznam, odbočenie pri editácii vlastnej správy, prepnutie,
 * zmazanie.
 *
 * ## Vetvenie nevytvára druhú cestu k modelu
 *
 * Odbočenie je **len zápis do `console_branches` a prepnutie
 * `active_branch_id`** — žiadna správa sa tu nezakladá. Upravenú správu zapíše
 * bežný beh (`POST /api/console/run`), presne ako každú inú. Bez toho by
 * vetvenie muselo samo písať do `console_messages` a stalo by sa druhým
 * pisateľom vedľa `AgentRunner`a; to je presne tá druhá cesta, ktorá tu nesmie
 * vzniknúť (§4 kontraktu).
 *
 * ## Prečo sa počas behu nevetví ani neprepína
 *
 * **Exkluzivita behu je na úrovni VLÁKNA, nie vetvy.** Prepnutie vetvy počas
 * rozbehnutého alebo zaparkovaného ťahu by z jedného vlákna urobilo dvoch
 * pisateľov, a tým by sa každý rozsah `from_message_id`–`to_message_id` v tom
 * vlákne stal nepresným — beh by hlásil cenu cudzieho ťahu a v detaile ukázal
 * cudzie správy. Preto obe operácie vlákno so živým behom **odmietnu**, a nie
 * „počkajú" ani „zaradia do frontu".
 */
class BranchController extends Controller
{
    /**
     * Beh v stave `running` bez zápisu dlhšie než toľkoto minút je mŕtvy (padol
     * s procesom) a vlákno neblokuje. Je to tá istá hodnota ako default
     * `staleAfterMinutes` v {@see \App\Services\Console\RunRecorder::openExclusive()}
     * a ako strop `mind:reap-runs` — keby sa rozišli, vetvenie by odmietalo beh,
     * ktorý zametač už zahodil.
     */
    private const STALE_AFTER_MINUTES = 30;

    /** @var array<string, string> */
    private const MESSAGES = [
        'message.required' => 'Chýba správa, od ktorej sa má vetva odraziť.',
        'message.integer' => 'Identifikátor správy nemá platný tvar.',
    ];

    /**
     * Vetvy vlákna pre prepínač. Vetiev na vlákno sú jednotky, takže sa čítajú
     * všetky naraz — na to je zložený index `['thread_id', 'id']`.
     */
    public function index(ConsoleThread $thread): JsonResponse
    {
        $branches = $thread->branches()->orderBy('id')->get();
        $current = $thread->currentBranch($branches->keyBy('id'));

        $own = ConsoleMessage::query()
            ->where('thread_id', $thread->id)
            ->whereNotNull('branch_id')
            ->selectRaw('branch_id, COUNT(*) as messages, MAX(id) as last_message_id')
            ->groupBy('branch_id')
            ->get()
            ->keyBy('branch_id');

        return response()->json([
            'active' => $current?->uuid,
            'branches' => $branches->map(fn (ConsoleBranch $b) => [
                'uuid' => $b->uuid,
                'root' => $b->isRoot(),
                'parent' => $b->parent_branch_id === null
                    ? null
                    : $branches->firstWhere('id', $b->parent_branch_id)?->uuid,
                // Posledná dedená správa — klient podľa nej vie, kde sa vetva
                // odrazila. `0` znamená „nededí nič" (editácia prvej správy).
                'forked_from_message_id' => $b->forked_from_message_id,
                'messages' => (int) ($own[$b->id]->messages ?? 0),
                'last_message_id' => $own[$b->id]->last_message_id ?? null,
                'created_at' => $b->created_at?->toIso8601String(),
            ])->all(),
        ]);
    }

    /**
     * Odbočenie pri editácii vlastnej správy. Nová vetva dedí všetko PRED tou
     * správou; **pôvodná zostáva** čitateľná aj so svojím pokračovaním.
     *
     * Vetví sa len od správy človeka: editácia odpovede modelu by nebola editácia,
     * ale prepísanie histórie — a to je jediná vec, ktorú vetvenie výslovne
     * neumožňuje.
     */
    public function store(Request $request, ConsoleThread $thread): JsonResponse
    {
        $data = $request->validate([
            'message' => 'required|integer',
        ], self::MESSAGES);

        if ($busy = $this->busy($thread)) {
            return response()->json(['message' => $busy], 409);
        }

        // Správa sa hľadá V RÁMCI vlákna: id z cudzieho vlákna by inak založilo
        // vetvu, ktorá dedí prefix odinakiaľ.
        $message = ConsoleMessage::query()
            ->where('thread_id', $thread->id)
            ->where('id', $data['message'])
            ->first();

        if ($message === null) {
            return response()->json(['message' => 'Taká správa v tomto vlákne nie je.'], 404);
        }

        if ($message->role !== 'user') {
            return response()->json(['message' => 'Vetviť sa dá len od vlastnej správy.'], 422);
        }

        // Vlákno bez vetvy (nové, alebo z čias pred vetvením) najprv dostane
        // korennú — inak by nová vetva nemala rodiča a jej prefix by visel.
        ConsoleBranch::rootFor($thread);

        // Vlákno sa správe podstrčí ako už načítaný vzťah: bez toho by si ho
        // `forkBefore()` dotiahol znova a pracoval nad DRUHOU instanciou toho
        // istého riadku — teda nad kópiou, ktorá o `active_branch_id` z riadku
        // vyššie ešte nemusí vedieť.
        $message->setRelation('thread', $thread);

        $branch = DB::transaction(function () use ($thread, $message): ConsoleBranch {
            $branch = ConsoleBranch::forkBefore($message);

            $thread->active_branch_id = $branch->id;
            $thread->save();

            return $branch;
        });

        return response()->json([
            'uuid' => $branch->uuid,
            'forked_from_message_id' => $branch->forked_from_message_id,
            'active' => true,
        ], 201);
    }

    /** Prepnutie aktívnej vetvy. Správy sa nemenia — mení sa len to, ktoré z nich sú história. */
    public function activate(ConsoleBranch $branch): JsonResponse
    {
        $thread = $branch->thread;

        if ($busy = $this->busy($thread)) {
            return response()->json(['message' => $busy], 409);
        }

        $thread->active_branch_id = $branch->id;
        $thread->save();

        return response()->json(['active' => $branch->uuid]);
    }

    /**
     * Zmazanie vetvy. Jej správy idú kaskádou, **`runs` zostávajú** — log behov
     * má prežiť zmazanie toho, o čom hovorí (`runs.branch_id` je bez cudzieho
     * kľúča, takže z neho zostane čitateľný visiaci ukazovateľ).
     *
     * Korenná vetva sa zmazať nedá: kaskáda by s ňou vzala všetky svoje potomstvo
     * aj celú konverzáciu, čo je „zmazať vlákno" pod iným menom. Na to je
     * `DELETE /api/console/threads/{uuid}`.
     */
    public function destroy(ConsoleBranch $branch): JsonResponse
    {
        $thread = $branch->thread;

        if ($busy = $this->busy($thread)) {
            return response()->json(['message' => $busy], 409);
        }

        if ($branch->isRoot()) {
            return response()->json(['message' => 'Korennú vetvu vlákna zmazať nemožno.'], 422);
        }

        $parentId = $branch->parent_branch_id;
        $branchId = (int) $branch->id;

        DB::transaction(function () use ($thread, $branch, $branchId, $parentId): void {
            $branch->delete();

            // Mazala sa aktívna vetva → aktívnou sa stane rodič. Bez tohto by
            // `active_branch_id` visel a čítanie by spadlo na korennú vetvu, teda
            // človek by po zmazaní pobočky skončil na inom mieste konverzácie,
            // než z ktorého vyšel.
            if ($thread->active_branch_id === $branchId) {
                $thread->active_branch_id = $parentId;
                $thread->save();
            }
        });

        return response()->json(['deleted' => true]);
    }

    /**
     * Prekážka, ktorá vlákno drží — alebo `null`, keď je voľné.
     *
     * Kontrolujú sa dve veci a obe sú na úrovni **vlákna**: nedorozhodnutý zápis
     * (ten čaká na človeka a môže čakať dni) a beh, ktorý naozaj beží. Beh
     * v stave `running`, ktorý sa {@see self::STALE_AFTER_MINUTES} minút
     * neohlásil, padol s procesom a vlákno neblokuje — inak by jeden reštart
     * kontejnera zamkol vetvenie navždy.
     */
    private function busy(ConsoleThread $thread): ?string
    {
        if ($thread->pendingToolCall() !== null) {
            return 'Vlákno čaká na rozhodnutie o zápise. Najprv ho povoľ alebo zamietni.';
        }

        $live = Run::query()
            ->where('thread_id', $thread->id)
            ->where('status', 'running')
            ->where('updated_at', '>=', now()->subMinutes(self::STALE_AFTER_MINUTES))
            ->exists();

        return $live ? 'V tomto vlákne prebieha beh. Počkaj, kým dobehne, alebo ho zastav.' : null;
    }
}
