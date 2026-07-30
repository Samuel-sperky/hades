<?php

namespace App\Llm;

use App\Models\LlmRun;
use Throwable;

/**
 * Dekorátor, ktorý o každom volaní modelu zapíše riadok do `llm_runs`
 * (rozhodnutie #145, panel na obrazovke Dnes je P10). Vlastník P5.
 *
 * Prečo dekorátor a nie zápis v OllamaProvideri: telemetria nie je funkcia
 * providera a jednotkové testy providera nemajú potrebovať databázu.
 *
 * Zápis NIKDY nesmie zhodiť požiadavku — každá chyba perzistencie sa ticho
 * pohltí. Do stĺpca `error` ide len text z ChatResult::$error, ktorý podľa
 * kontraktu #11 nikdy neobsahuje kľúč ani token.
 */
final class RecordingProvider implements ChatProvider
{
    public function __construct(private readonly ChatProvider $inner) {}

    public function chat(array $messages, ChatOptions $opts): ChatResult
    {
        $result = $this->inner->chat($messages, $opts);
        $this->record($opts->task ?? 'chat', $result);

        return $result;
    }

    public function stream(array $messages, ChatOptions $opts, callable $onDelta): ChatResult
    {
        $result = $this->inner->stream($messages, $opts, $onDelta);
        $this->record($opts->task ?? 'chat', $result);

        return $result;
    }

    public function embed(array $texts, EmbedOptions $opts): array
    {
        $started = microtime(true);
        $vectors = $this->inner->embed($texts, $opts);

        $this->write([
            'task' => 'embed',
            'model' => $opts->model ?? 'unknown',
            'provider' => $this->inner->name(),
            'prompt_tokens' => 0,
            'completion_tokens' => count($vectors),
            'ms' => (int) round((microtime(true) - $started) * 1000),
            'tok_per_s' => 0.0,
            'ok' => $vectors !== [],
            'error' => $vectors === [] ? 'embedding nie je dostupný' : null,
        ]);

        return $vectors;
    }

    public function health(): ProviderHealth
    {
        // Health sa nezapisuje — beží často a nie je to volanie modelu.
        return $this->inner->health();
    }

    public function name(): string
    {
        return $this->inner->name();
    }

    /** Obalený provider — pre volajúcich, ktorí potrebujú konkrétny typ. */
    public function inner(): ChatProvider
    {
        return $this->inner;
    }

    private function record(string $task, ChatResult $result): void
    {
        $this->write([
            'task' => $task,
            'model' => $result->model,
            'provider' => $this->inner->name(),
            'prompt_tokens' => $result->promptTokens,
            'completion_tokens' => $result->completionTokens,
            'ms' => $result->ms,
            'tok_per_s' => $result->tokPerS,
            'ok' => $result->ok(),
            'error' => $result->error,
        ]);
    }

    /** @param  array<string, mixed>  $row */
    private function write(array $row): void
    {
        try {
            LlmRun::create($row + ['created_at' => now()]);
        } catch (Throwable) {
            // Telemetria nikdy nezhodí požiadavku.
        }
    }
}
