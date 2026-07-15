<?php

namespace Tests\Unit;

use App\Services\MindMirror;
use PHPUnit\Framework\TestCase;

class MindMirrorPathTest extends TestCase
{
    private function mirror(): MindMirror
    {
        return new MindMirror;
    }

    public function test_slug_transliterates_slovak_diacritics(): void
    {
        $this->assertSame('vyvoj-kod', $this->mirror()->slug('Vývoj & kód'));
        $this->assertSame('konverzny-lievik', $this->mirror()->slug('Konverzný lievik'));
    }

    public function test_slug_falls_back_to_node_for_empty_result(): void
    {
        $this->assertSame('node', $this->mirror()->slug('—  ///  —'));
        $this->assertSame('node', $this->mirror()->slug(''));
    }

    public function test_slug_is_truncated(): void
    {
        $long = str_repeat('a', 200);
        $this->assertLessThanOrEqual(80, mb_strlen($this->mirror()->slug($long)));
    }
}
