<?php

namespace App\Http\Controllers\Api;

use App\Events\MindPulse;
use App\Http\Controllers\Api\Concerns\HandlesBrainErrors;
use App\Http\Controllers\Controller;
use App\Models\Node;
use App\Serializers\Screen\HygienaScreen;
use App\Serializers\Screen\KontrolaScreen;
use App\Services\Brain\BrainWriter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Kontrola — verify/review fronta. Číta interné /api/* (SPA, bez tokenu) aj
 * externé /api/v1/* (Bearer). Štyri operácie, z toho dve čítacie:
 *   - GET  review/queue                 — uzly needs_review od najnovších
 *   - POST nodes/{node}/verify          — verified_at=now, certainty=overene,
 *       needs_review=false; pri guard ON + origin=brain aj frontmatter upgrade
 *       (.md master, {@see BrainWriter::verify}), pri guard OFF len DB + warning
 *   - POST nodes/{node}/resolve-review  — len needs_review=false (bez overenia)
 *   - GET  hygiene                      — správa o odpade v pamäti (len čítanie,
 *       {@see HygienaScreen}); sekcia „Hygiena" na tej istej obrazovke, nález A3
 *
 * Každá mutácia vyšle MindPulse (`node.updated`), aby sa vizualizácia + rail
 * počítadlo Kontroly hneď dorovnali.
 */
class ReviewController extends Controller
{
    use HandlesBrainErrors;

    /**
     * GET — fronta uzlov na kontrolu (needs_review = true), od najnovších.
     * `total` slúži rail počítadlu (#dest-kontrola .count), `queue` zoznamu.
     *
     * Tvar odpovede drží {@see KontrolaScreen} — tá istá trieda, z ktorej čerpá
     * MCP tool `mind_review`. Do vlny E vedelo MCP z celej tejto obrazovky vrátiť
     * jedno číslo, takže AI frontu plnila a nevidela ju.
     *
     * Parametre filtrov sa **nevalidujú, ale sanitizujú** v serializéri: endpoint
     * ich doteraz nepoznal a mlčky zahadzoval, takže 422 by bola zmena chovania
     * externého mirroru `/api/v1/review/queue`.
     */
    public function queue(Request $request): JsonResponse
    {
        return response()->json((new KontrolaScreen($request->query()))->data());
    }

    /**
     * GET — hygiena pamäti: koľko uzlov padá do ktorej triedy odpadu, s pár
     * príkladmi. Len na čítanie, nič sa nemení.
     *
     * Sedí na Kontrole zámerne (nález A3): obe sekcie hovoria o tom istom — čo
     * v pamäti čaká na rozhodnutie človeka. Novú obrazovku kontrakt zmrazil.
     *
     * Tvar drží {@see HygienaScreen} — tá istá trieda, z ktorej čerpá MCP tool
     * `mind_hygiene`. Do tejto vlny videla odpad LEN AI: grep nad
     * `public/js/mind/` a `mind.blade.php` nedal ani jeden zásah.
     *
     * Je to prechod celou sieťou (uzly + hrany), nie dopyt, takže obrazovka si
     * ho ťahá **raz** a nie s každým prekreslením fronty.
     *
     * `class` sem z UI nechodí; keď ju niekto pošle ručne a je neznáma, príkaz ju
     * odmietne a jeho chyba menuje platné triedy — vraciame ju ako 422, nie ako
     * 500, pretože je to chyba požiadavky, nie servera.
     */
    public function hygiene(Request $request): JsonResponse
    {
        try {
            return response()->json((new HygienaScreen($request->query()))->data());
        } catch (\InvalidArgumentException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }
    }

    /**
     * POST — označí uzol ako overený. DB stav sa nastaví VŽDY. Pri guard ON +
     * origin=brain sa navyše povýši frontmatter `.md` (markdown je master) a
     * targetovane resyncne; DB polia dorovnáme AŽ PO resyncu, aby ich prípadné
     * pretvorenie uzla neprepísalo. Pri guard OFF (alebo origin=session) len DB
     * + warning, že `.md` sa nedotklo.
     */
    public function verify(Node $node): JsonResponse
    {
        $guardOn = (bool) config('hades.allow_brain_write');

        // guard ON + brain uzol → frontmatter upgrade + resync, potom DB dorovnaj
        if ($guardOn && $node->origin === 'brain') {
            return $this->guardBrain(function () use ($node) {
                $result = app(BrainWriter::class)->verify($node);

                $fresh = $node->fresh() ?? $node;
                $this->applyVerified($fresh);

                return response()->json([
                    'node' => ($fresh->fresh() ?? $fresh)->load('tags')->toApi(),
                    'source_file' => $result['source_file'],
                    'warnings' => $result['warnings'],
                    'sync' => $result['sync'],
                    'queue_total' => $this->queueTotal(),
                ]);
            });
        }

        // guard OFF (alebo session uzol) → DB-only overenie
        $warnings = [];
        if ($node->origin === 'brain' && ! $guardOn) {
            $warnings[] = 'Brain-write je vypnutý — frontmatter .md sa neaktualizoval, '
                .'uzol je overený len v DB indexe.';
        }

        $this->applyVerified($node);

        return response()->json([
            'node' => ($node->fresh() ?? $node)->load('tags')->toApi(),
            'warnings' => $warnings,
            'queue_total' => $this->queueTotal(),
        ]);
    }

    /**
     * POST — vyrieši kontrolu bez overenia: len zhodí needs_review. Certainty,
     * verified_at ani ostatné polia sa nemenia (uzol ostáva ako je, len von z fronty).
     */
    public function resolveReview(Node $node): JsonResponse
    {
        $node->forceFill(['needs_review' => false])->save();

        $fresh = $node->fresh() ?? $node;
        MindPulse::dispatch('node.updated', ['node' => $fresh->load('tags')->toApi()]);

        return response()->json([
            'node' => $fresh->load('tags')->toApi(),
            'queue_total' => $this->queueTotal(),
        ]);
    }

    /**
     * Dĺžka fronty PO tejto mutácii.
     *
     * Aditívny kľúč, ktorý nesie konkrétny rozchod: obrazovka si počítadlo v raile
     * po každej akcii **dopočítavala sama** (`kontrola.js:137`, `total - 1`), takže
     * po paralelnej session, po `mind_learn` z inej AI alebo po mutácii, ktorá
     * zhodila viac než jeden uzol, ukazoval rail iné číslo než server. Jedna
     * `COUNT(*)` v odpovedi na mutáciu je lacnejšia než refetch celej fronty
     * a pravdivejšia než odčítanie jednotky.
     */
    private function queueTotal(): int
    {
        return (int) Node::query()->where('needs_review', true)->count();
    }

    /**
     * DB stav overeného uzla: verified_at=now, certainty=overene, needs_review=false.
     * forceFill obchádza fillable pre istotu a vyšle pulz na vizualizáciu.
     */
    private function applyVerified(Node $node): void
    {
        $node->forceFill([
            'verified_at' => now(),
            'certainty' => 'overene',
            'needs_review' => false,
        ])->save();

        $fresh = $node->fresh() ?? $node;
        MindPulse::dispatch('node.updated', ['node' => $fresh->load('tags')->toApi()]);
    }
}
