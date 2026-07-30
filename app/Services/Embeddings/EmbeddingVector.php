<?php

namespace App\Services\Embeddings;

/**
 * Binárna reprezentácia vektora + kosínusová podobnosť. Čisté funkcie, žiadny
 * stav, žiadna DB — testovateľné bez databázy aj bez providera.
 *
 * Formát: packed float32 little-endian ('g*'). Dimenzia je odvoditeľná z dĺžky
 * blobu (strlen / 4), takže sa neukládá do samostatného stĺpca. Little-endian
 * je zvolený zámerne (nie 'f*' = host order), aby bol blob prenosný medzi stroji.
 */
final class EmbeddingVector
{
    /** Bajtov na jednu float32 hodnotu. */
    public const BYTES = 4;

    /**
     * Vektor → blob. Vstup sa L2-normalizuje, takže kosínus je potom obyčajný
     * skalárny súčin a nikdy nedelíme nulou pri porovnávaní.
     *
     * @param  list<float>  $vector
     */
    public static function pack(array $vector): string
    {
        return pack('g*', ...self::normalize($vector));
    }

    /**
     * Blob → vektor. Nekompletný alebo prázdny blob dá prázdny list (nie chybu) —
     * vektorová vetva recallu ho potom len preskočí.
     *
     * @return list<float>
     */
    public static function unpack(?string $blob): array
    {
        if ($blob === null || $blob === '' || strlen($blob) % self::BYTES !== 0) {
            return [];
        }

        $values = unpack('g*', $blob);

        return $values === false ? [] : array_values(array_map(static fn ($v) => (float) $v, $values));
    }

    /** Dimenzia uloženého vektora bez jeho rozbalenia. */
    public static function dimensions(?string $blob): int
    {
        if ($blob === null || $blob === '') {
            return 0;
        }

        return intdiv(strlen($blob), self::BYTES);
    }

    /**
     * L2 normalizácia. Nulový vektor sa vráti nezmenený (nedelíme nulou).
     *
     * @param  list<float>  $vector
     * @return list<float>
     */
    public static function normalize(array $vector): array
    {
        $sum = 0.0;
        foreach ($vector as $v) {
            $sum += (float) $v * (float) $v;
        }

        if ($sum <= 0.0) {
            return array_map(static fn ($v) => (float) $v, array_values($vector));
        }

        $norm = sqrt($sum);

        return array_map(static fn ($v) => (float) $v / $norm, array_values($vector));
    }

    /**
     * Kosínusová podobnosť dvoch vektorov v rozsahu 0..1. Negatívna podobnosť sa
     * zráža na 0 — recall nepotrebuje „opak", len „ako blízko". Nezhodné dimenzie
     * alebo prázdny vektor dajú 0.0 (žiadna výnimka, žiadny log).
     *
     * @param  list<float>  $a
     * @param  list<float>  $b
     */
    public static function cosine(array $a, array $b): float
    {
        $n = count($a);
        if ($n === 0 || $n !== count($b)) {
            return 0.0;
        }

        $dot = 0.0;
        $normA = 0.0;
        $normB = 0.0;
        for ($i = 0; $i < $n; $i++) {
            $x = (float) $a[$i];
            $y = (float) $b[$i];
            $dot += $x * $y;
            $normA += $x * $x;
            $normB += $y * $y;
        }

        if ($normA <= 0.0 || $normB <= 0.0) {
            return 0.0;
        }

        $cos = $dot / (sqrt($normA) * sqrt($normB));

        return max(0.0, min(1.0, $cos));
    }
}
