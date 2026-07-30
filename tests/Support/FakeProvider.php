<?php

namespace Tests\Support;

use App\Llm\ChatOptions;
use App\Llm\ChatProvider;
use App\Llm\ChatResult;
use App\Llm\EmbedOptions;
use App\Llm\ProviderHealth;

/**
 * ZAMKNUTÉ ROZHRANIE (#12) — testovací provider, aby P1 a P3 mohli testovať
 * PRED dokončením P5. Vlastník: koordinátor; A1/A2/A3 ho len používajú.
 *
 * Deterministický: rovnaký vstup → rovnaký výstup, žiadna sieť, žiadny čas.
 * Embeddingy sú hash → vektor, takže sú stabilné medzi behmi aj medzi stroji.
 *
 * Použitie:
 *
 *   $p = new FakeProvider(reply: 'Zhrnutie');
 *   $this->app->instance(ChatProvider::class, $p);
 *   // …
 *   $this->assertSame(1, $p->chatCalls);
 *
 *   // simulácia vypnutej Ollamy — appka musí fungovať ďalej:
 *   $this->app->instance(ChatProvider::class, (new FakeProvider)->broken());
 */
final class FakeProvider implements ChatProvider
{
    public int $chatCalls = 0;

    public int $streamCalls = 0;

    public int $embedCalls = 0;

    /** @var list<array<int, array{role: string, content: string}>> */
    public array $seenMessages = [];

    private bool $broken = false;

    public function __construct(
        private string $reply = 'fake odpoveď',
        private string $model = 'fake-model',
    ) {}

    /** Simuluje nedostupný model — všetko vracia chybu, ale NIKDY nevyhodí výnimku. */
    public function broken(): self
    {
        $this->broken = true;

        return $this;
    }

    public function reply(string $text): self
    {
        $this->reply = $text;

        return $this;
    }

    public function chat(array $messages, ChatOptions $opts): ChatResult
    {
        $this->chatCalls++;
        $this->seenMessages[] = $messages;

        if ($this->broken) {
            return ChatResult::failed($this->model, 'fake: provider je nedostupný');
        }

        return new ChatResult(
            text: $this->reply,
            model: $opts->model ?? $this->model,
            promptTokens: $this->countTokens($messages),
            completionTokens: max(1, (int) ceil(mb_strlen($this->reply) / 4)),
            ms: 10,
            tokPerS: 100.0,
            finishReason: 'stop',
        );
    }

    public function stream(array $messages, ChatOptions $opts, callable $onDelta): ChatResult
    {
        $this->streamCalls++;

        if ($this->broken) {
            return ChatResult::failed($this->model, 'fake: provider je nedostupný');
        }

        // Chunkuje po slovách, aby test videl viac než jeden delta callback.
        foreach (preg_split('/(?<=\s)/u', $this->reply) ?: [$this->reply] as $chunk) {
            if ($chunk !== '') {
                $onDelta($chunk);
            }
        }

        return $this->chat($messages, $opts);
    }

    public function embed(array $texts, EmbedOptions $opts): array
    {
        $this->embedCalls++;

        if ($this->broken) {
            return [];
        }

        $out = [];
        foreach ($texts as $text) {
            $out[] = $this->hashVector((string) $text, $opts->dimensions);
        }

        return $out;
    }

    public function health(): ProviderHealth
    {
        if ($this->broken) {
            return ProviderHealth::down('fake: provider je nedostupný');
        }

        return new ProviderHealth(
            ok: true,
            chat: true,
            embed: true,
            models: [$this->model],
            latencyMs: 1,
        );
    }

    public function name(): string
    {
        return 'fake';
    }

    /**
     * Stabilný pseudo-embedding: sha256 textu rozbalený na float v <-1, 1>,
     * L2-normalizovaný, aby kosínusová podobnosť dávala zmysel. Rovnaký text
     * dá vždy rovnaký vektor, rôzne texty takmer ortogonálne vektory.
     *
     * @return list<float>
     */
    private function hashVector(string $text, int $dimensions): array
    {
        $vec = [];
        $seed = 0;
        while (count($vec) < $dimensions) {
            $digest = hash('sha256', $text.'#'.$seed++, true);
            foreach (unpack('C*', $digest) ?: [] as $byte) {
                if (count($vec) >= $dimensions) {
                    break;
                }
                $vec[] = ($byte - 127.5) / 127.5;
            }
        }

        $norm = sqrt(array_sum(array_map(fn (float $v) => $v * $v, $vec))) ?: 1.0;

        return array_map(fn (float $v) => $v / $norm, $vec);
    }

    /** @param  array<int, array{role: string, content: string}>  $messages */
    private function countTokens(array $messages): int
    {
        $chars = 0;
        foreach ($messages as $m) {
            $chars += mb_strlen((string) ($m['content'] ?? ''));
        }

        return max(1, (int) ceil($chars / 4));
    }
}
