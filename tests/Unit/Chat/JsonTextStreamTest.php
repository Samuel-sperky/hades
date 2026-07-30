<?php

namespace Tests\Unit\Chat;

use App\Services\Chat\JsonTextStream;
use App\Services\Chat\ModelText;
use PHPUnit\Framework\TestCase;

/**
 * Rozbalenie JSON obalu `{"text":"…"}` počas streamovania.
 *
 * Obal je vynútený meraním: `think:false` sám nestačí, qwen3:4b bez
 * `format:"json"` vylieva uvažovanie do obsahu (docs/BENCHMARK-LLM.md §5).
 * Klient však musí vidieť text, nie JSON — to je práca tohto automatu.
 */
class JsonTextStreamTest extends TestCase
{
    public function test_rozbali_text_z_celeho_obalu(): void
    {
        $stream = new JsonTextStream;

        $this->assertSame('Ahoj', $stream->push('{"text":"Ahoj"}'));
        $this->assertTrue($stream->finished());
    }

    public function test_rozbali_text_rozdeleny_do_mnohych_delt(): void
    {
        $stream = new JsonTextStream;
        $out = '';

        foreach (['{"te', 'xt"', ' : ', '"V pam', 'äti mám ', '679 uzlov"', '}'] as $chunk) {
            $out .= $stream->push($chunk);
        }

        $this->assertSame('V pamäti mám 679 uzlov', $out);
        $this->assertTrue($stream->finished());
    }

    public function test_zvlada_escapovanie(): void
    {
        $stream = new JsonTextStream;

        $out = $stream->push('{"text":"prvý\ndruhý \"citát\" a lomka \\\\ koniec"}');

        $this->assertSame("prvý\ndruhý \"citát\" a lomka \\ koniec", $out);
    }

    public function test_zvlada_multibyte_znak_rozdeleny_medzi_dve_delty(): void
    {
        $stream = new JsonTextStream;

        // „ä" je 0xC3 0xA4 — prvá delta končí prvým bajtom.
        $first = $stream->push('{"text":"p'."\xC3");
        $second = $stream->push("\xA4".'mäť"}');

        $this->assertSame('pämäť', $first.$second);
    }

    public function test_zvlada_unicode_escape(): void
    {
        $stream = new JsonTextStream;

        // Ollama posiela diakritiku aj ako \uXXXX — automat ju musí zložiť.
        $this->assertSame('päť', $stream->push('{"text":"p\u00e4\u0165"}'));
    }

    public function test_bez_obalu_nevrati_nic(): void
    {
        $stream = new JsonTextStream;

        $this->assertSame('', $stream->push('Okay, let us see. The user wants…'));
        $this->assertTrue($stream->empty(), 'model obal nedodržal → volajúci musí použiť šablónu');
    }

    public function test_model_text_extrahuje_finalny_text_a_zamer(): void
    {
        $this->assertSame('V pamäti mám 679 uzlov', ModelText::extract('{"text": "V pamäti mám 679 uzlov"}'));
        $this->assertNull(ModelText::extract('Okay, the user wants…'));
        $this->assertNull(ModelText::extract('{"text": "   "}'));

        $this->assertSame('shop.orders_count', ModelText::intent('{"intent":"shop.orders_count"}'));
        $this->assertNull(ModelText::intent('nie json'));
    }
}
