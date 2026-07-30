<?php

namespace Tests\Unit\Llm;

use App\Llm\AnthropicProvider;
use App\Llm\ChatOptions;
use App\Llm\ChatProvider;
use App\Llm\ChatResult;
use App\Llm\EmbedOptions;
use App\Llm\NullProvider;
use App\Llm\ProviderFactory;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;
use Tests\Support\FakeProvider;

/**
 * BRÁNA ZAMKNUTÉHO ROZHRANIA #11 a #12.
 *
 * P1, P3 a P5 stavajú na tomto kontrakte súčasne. Test padne, keď niekto zmení
 * signatúru alebo poruší pravidlo „nedostupný model nevyhadzuje výnimku".
 * Vlastník: koordinátor. Balíky ho needitujú — menia sa proti nemu.
 */
class ChatProviderContractTest extends TestCase
{
    public function test_interface_ma_presne_zamknute_metody_a_signatury(): void
    {
        $expected = [
            'chat' => ['array $messages', 'App\Llm\ChatOptions $opts'],
            'stream' => ['array $messages', 'App\Llm\ChatOptions $opts', 'callable $onDelta'],
            'embed' => ['array $texts', 'App\Llm\EmbedOptions $opts'],
            'health' => [],
            'name' => [],
        ];
        $returns = [
            'chat' => 'App\Llm\ChatResult',
            'stream' => 'App\Llm\ChatResult',
            'embed' => 'array',
            'health' => 'App\Llm\ProviderHealth',
            'name' => 'string',
        ];

        $methods = get_class_methods(ChatProvider::class);
        sort($methods);
        $wanted = array_keys($expected);
        sort($wanted);
        $this->assertSame($wanted, $methods, 'ChatProvider má iné metódy než zamknutý kontrakt');

        foreach ($expected as $name => $params) {
            $m = new ReflectionMethod(ChatProvider::class, $name);
            $actual = array_map(
                fn ($p) => trim(($p->getType() ? $p->getType()->getName().' ' : '').'$'.$p->getName()),
                $m->getParameters(),
            );
            $this->assertSame($params, $actual, "parametre {$name}() sa rozišli s kontraktom");
            $this->assertSame($returns[$name], (string) $m->getReturnType(), "návratový typ {$name}()");
        }
    }

    /** @return list<array{0: ChatProvider}> */
    public static function providers(): array
    {
        return [
            'null' => [new NullProvider],
            'fake' => [new FakeProvider],
            'fake broken' => [(new FakeProvider)->broken()],
            'anthropic bez kluca' => [new AnthropicProvider(null, 'x')],
        ];
    }

    /**
     * PHPUnit 12 už nečíta anotáciu `@dataProvider` z doc-komentára — viazanie
     * musí byť atribútom, inak sa test spustí s nula argumentmi a padne na
     * ArgumentCountError.
     */
    #[DataProvider('providers')]
    public function test_ziadna_metoda_nevyhodi_vynimku_pri_nedostupnom_modeli(ChatProvider $p): void
    {
        $messages = [['role' => 'user', 'content' => 'ahoj']];

        $chat = $p->chat($messages, new ChatOptions);
        $this->assertInstanceOf(ChatResult::class, $chat);

        $deltas = [];
        $stream = $p->stream($messages, new ChatOptions, function (string $t) use (&$deltas) { $deltas[] = $t; });
        $this->assertInstanceOf(ChatResult::class, $stream);

        $this->assertIsArray($p->embed(['text'], new EmbedOptions));
        $this->assertIsBool($p->health()->ok);
        $this->assertNotSame('', $p->name());
    }

    public function test_null_provider_hlasi_nedostupnost_bez_chyby(): void
    {
        $p = new NullProvider;

        $this->assertFalse($p->health()->ok);
        $this->assertSame('null', $p->name());
        $this->assertSame([], $p->embed(['a', 'b'], new EmbedOptions), 'prázdny list = vektorová vetva sa vynechá');
        $this->assertSame('error', $p->chat([], new ChatOptions)->finishReason);
        $this->assertFalse($p->chat([], new ChatOptions)->ok());
    }

    public function test_factory_vracia_null_provider_kym_je_llm_vypnuty(): void
    {
        $f = new ProviderFactory(['enabled' => false]);

        $this->assertInstanceOf(NullProvider::class, $f->forChat());
        $this->assertInstanceOf(NullProvider::class, $f->forEmbed());
        $this->assertInstanceOf(NullProvider::class, $f->forEscalation());
    }

    public function test_fake_provider_je_deterministicky_a_pocita_volania(): void
    {
        $a = new FakeProvider;
        $b = new FakeProvider;

        $this->assertSame(
            $a->embed(['prepravca'], new EmbedOptions)[0],
            $b->embed(['prepravca'], new EmbedOptions)[0],
            'rovnaký text musí dať rovnaký vektor',
        );
        $this->assertNotSame(
            $a->embed(['prepravca'], new EmbedOptions)[0],
            $a->embed(['doprava'], new EmbedOptions)[0],
        );

        $vec = $a->embed(['x'], new EmbedOptions(dimensions: 384))[0];
        $this->assertCount(384, $vec);
        $norm = sqrt(array_sum(array_map(fn ($v) => $v * $v, $vec)));
        $this->assertEqualsWithDelta(1.0, $norm, 1e-9, 'vektor má byť L2-normalizovaný');

        $a->reply('odpoveď');
        $deltas = [];
        $a->stream([['role' => 'user', 'content' => 'q']], new ChatOptions, function ($t) use (&$deltas) { $deltas[] = $t; });
        $this->assertNotEmpty($deltas, 'stream musí zavolať onDelta aspoň raz');
        $this->assertSame('odpoveď', implode('', $deltas));
        $this->assertSame(1, $a->streamCalls);
    }

    public function test_prazdny_anthropic_kluc_nie_je_chyba(): void
    {
        $p = new AnthropicProvider(null, 'claude');

        $this->assertFalse($p->configured());
        // Bez kľúča sa NEHLÁSI chyba — provider je len nezapnutý.
        $this->assertNull($p->health()->error);
    }
}
