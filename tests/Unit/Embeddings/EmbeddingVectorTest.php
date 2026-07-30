<?php

namespace Tests\Unit\Embeddings;

use App\Services\Embeddings\EmbeddingVector;
use PHPUnit\Framework\TestCase;

/**
 * Binárny formát vektora a kosínus — čisté funkcie, bez DB a bez providera.
 * Formát je packed float32 little-endian, takže blob je prenosný medzi stroji.
 */
class EmbeddingVectorTest extends TestCase
{
    public function test_pack_and_unpack_round_trip(): void
    {
        $vector = EmbeddingVector::normalize([1.0, 2.0, -3.0, 0.5]);

        $back = EmbeddingVector::unpack(EmbeddingVector::pack($vector));

        $this->assertCount(4, $back);
        foreach ($vector as $i => $value) {
            $this->assertEqualsWithDelta($value, $back[$i], 1e-6);
        }
    }

    public function test_pack_normalizes_the_vector(): void
    {
        $back = EmbeddingVector::unpack(EmbeddingVector::pack([3.0, 4.0]));

        $this->assertEqualsWithDelta(0.6, $back[0], 1e-6);
        $this->assertEqualsWithDelta(0.8, $back[1], 1e-6);
    }

    public function test_dimensions_are_derived_from_the_blob_length(): void
    {
        $blob = EmbeddingVector::pack(array_fill(0, 1024, 0.1));

        $this->assertSame(4096, strlen($blob));
        $this->assertSame(1024, EmbeddingVector::dimensions($blob));
        $this->assertSame(0, EmbeddingVector::dimensions(null));
        $this->assertSame(0, EmbeddingVector::dimensions(''));
    }

    public function test_unpack_of_a_broken_blob_returns_empty_instead_of_throwing(): void
    {
        $this->assertSame([], EmbeddingVector::unpack('abc'));   // 3 B nie je násobok 4
        $this->assertSame([], EmbeddingVector::unpack(''));
        $this->assertSame([], EmbeddingVector::unpack(null));
    }

    public function test_normalize_leaves_a_zero_vector_alone(): void
    {
        $this->assertSame([0.0, 0.0], EmbeddingVector::normalize([0.0, 0.0]));
    }

    public function test_cosine_of_identical_vectors_is_one(): void
    {
        $a = [0.1, 0.7, -0.2, 0.4];

        $this->assertEqualsWithDelta(1.0, EmbeddingVector::cosine($a, $a), 1e-9);
    }

    public function test_cosine_of_orthogonal_vectors_is_zero(): void
    {
        $this->assertSame(0.0, EmbeddingVector::cosine([1.0, 0.0], [0.0, 1.0]));
    }

    public function test_negative_cosine_is_clamped_to_zero(): void
    {
        $this->assertSame(0.0, EmbeddingVector::cosine([1.0, 0.0], [-1.0, 0.0]));
    }

    public function test_cosine_is_zero_for_mismatched_or_empty_vectors(): void
    {
        $this->assertSame(0.0, EmbeddingVector::cosine([1.0, 0.0], [1.0]));
        $this->assertSame(0.0, EmbeddingVector::cosine([], []));
        $this->assertSame(0.0, EmbeddingVector::cosine([0.0, 0.0], [1.0, 1.0]));
    }

    public function test_cosine_ranks_a_closer_vector_higher(): void
    {
        $query = [1.0, 0.0, 0.0];
        $near = [0.9, 0.1, 0.0];
        $far = [0.2, 0.9, 0.1];

        $this->assertGreaterThan(
            EmbeddingVector::cosine($query, $far),
            EmbeddingVector::cosine($query, $near),
        );
    }
}
