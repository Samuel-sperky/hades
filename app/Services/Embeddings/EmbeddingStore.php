<?php

namespace App\Services\Embeddings;

use Illuminate\Support\Facades\DB;

/**
 * Čítanie a zápis vektorov v `nodes` (rozhodnutie #112b — žiadna vektorová DB).
 *
 * Zápis ide cez query builder, nie cez Eloquent `save()`, aby sa nemuseli meniť
 * `$fillable`/`$casts` v `App\Models\Node` (cudzí súbor) a aby sa uzlu nezmenil
 * `updated_at` — embedding je derivát, nie zmena poznatku.
 */
class EmbeddingStore
{
    /**
     * Uloží vektor k uzlu. `$hash` je odtlačok textu, z ktorého vektor vznikol.
     *
     * @param  list<float>  $vector
     */
    public function put(int $nodeId, array $vector, string $model, string $hash): void
    {
        DB::table('nodes')->where('id', $nodeId)->update([
            'embedding' => EmbeddingVector::pack($vector),
            'embedding_model' => $model,
            'embedding_hash' => $hash,
            'embedded_at' => now(),
        ]);
    }

    /**
     * Vektor uzla, alebo prázdny list keď uzol embedding nemá.
     *
     * @return list<float>
     */
    public function get(int $nodeId): array
    {
        $blob = DB::table('nodes')->where('id', $nodeId)->value('embedding');

        return EmbeddingVector::unpack($blob === null ? null : (string) $blob);
    }

    /**
     * Uložené vektory pre daný model a dimenziu, ako [node_id => vektor].
     * Jeden dopyt — bez N+1.
     *
     * `$model` = null znamená „ktorýkoľvek model"; vektory z iného modelu sa
     * NIKDY nemiešajú do jedného porovnania, preto je filtrovanie povinné vo
     * volajúcom (VectorSearch posiela aktuálny model).
     *
     * `$nodeIds` zúži načítanie na konkrétne uzly. Recall v režime 'rerank'
     * potrebuje kosínus len pre lexikálnych kandidátov (~12–60 uzlov), takže
     * načítať celý korpus (700 × 4 KB ≈ 2,8 MB + unpack 716 800 floatov) by
     * bola zbytočná práca — skóre ostatných uzlov sa aj tak zahodí.
     * `$nodeIds = []` vráti prázdno, `null` = celý korpus.
     *
     * @param  list<int>|null  $nodeIds
     * @return array<int, list<float>>
     */
    public function all(?string $model = null, ?int $dimensions = null, ?array $nodeIds = null): array
    {
        if ($nodeIds !== null && $nodeIds === []) {
            return [];
        }

        $rows = DB::table('nodes')
            ->whereNotNull('embedding')
            ->when($model !== null, fn ($q) => $q->where('embedding_model', $model))
            ->when($nodeIds !== null, fn ($q) => $q->whereIn('id', $nodeIds))
            ->get(['id', 'embedding']);

        $out = [];
        foreach ($rows as $row) {
            $vector = EmbeddingVector::unpack((string) $row->embedding);
            if ($vector === []) {
                continue;
            }
            if ($dimensions !== null && count($vector) !== $dimensions) {
                continue;
            }
            $out[(int) $row->id] = $vector;
        }

        return $out;
    }

    /** Počet uzlov s uloženým vektorom (voliteľne pre konkrétny model). */
    public function count(?string $model = null): int
    {
        return DB::table('nodes')
            ->whereNotNull('embedding')
            ->when($model !== null, fn ($q) => $q->where('embedding_model', $model))
            ->count();
    }

    /**
     * Stav embeddingu pre uzly, BEZ načítania blobov (LENGTH namiesto obsahu).
     * Jeden dopyt pre celý korpus — `aura:embed` z toho počíta „stale" v pamäti.
     *
     * @param  list<int>  $nodeIds  prázdne = všetky uzly
     * @return array<int, array{model: ?string, hash: ?string, dim: int}>
     */
    public function state(array $nodeIds = []): array
    {
        $rows = DB::table('nodes')
            ->when($nodeIds !== [], fn ($q) => $q->whereIn('id', $nodeIds))
            ->get(['id', 'embedding_model', 'embedding_hash', DB::raw('LENGTH(embedding) AS embedding_bytes')]);

        $out = [];
        foreach ($rows as $row) {
            $out[(int) $row->id] = [
                'model' => $row->embedding_model === null ? null : (string) $row->embedding_model,
                'hash' => $row->embedding_hash === null ? null : (string) $row->embedding_hash,
                'dim' => intdiv((int) ($row->embedding_bytes ?? 0), EmbeddingVector::BYTES),
            ];
        }

        return $out;
    }

    /**
     * Potrebuje uzol (pre)počítať vektor? True keď ešte žiadny nemá, keď ho má
     * z iného modelu, keď má inú dimenziu, alebo keď sa mu zmenil text.
     *
     * @param  array{model: ?string, hash: ?string, dim: int}|null  $state
     */
    public function isStale(?array $state, string $model, string $hash, int $dimensions): bool
    {
        if ($state === null || $state['dim'] === 0) {
            return true;
        }

        return $state['model'] !== $model
            || $state['hash'] !== $hash
            || $state['dim'] !== $dimensions;
    }
}
