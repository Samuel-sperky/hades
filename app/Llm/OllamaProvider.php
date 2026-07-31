<?php

namespace App\Llm;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Lokálny Ollama runtime. Vlastník P5.
 *
 * ŽELEZNÉ PRAVIDLO ROZHRANIA #11: žiadna metóda nevyhodí výnimku pri nedostupnej
 * Ollame ani pri chýbajúcom modeli — vracia ChatResult::failed() / ProviderHealth::down()
 * a rozhoduje volajúci. Vďaka tomu je appka plne funkčná aj keď Ollama vôbec nebeží.
 *
 * Provider je ZÁMERNE hlúpy prenos: streamuje surové delty tak, ako ich pošle model.
 * Keď je úloha v `config('llm.tasks')` označená `format: json`, obsah je JSON obal
 * `{"text":"…"}` a rozbaľuje ho volajúci (JsonTextStream / ModelText) — provider
 * nepozná konvenciu odpovede.
 *
 * Modely a parametre sa neriešia v kóde, ale v `config/llm.php` per úloha
 * (`ChatOptions::$task`), takže sa nemusí meniť zamknuté DTO.
 */
final class OllamaProvider implements ChatProvider
{
    /**
     * @param  array<string, string>  $models  kľúč úlohy → tag modelu ('router'|'escalation'|'embed')
     * @param  array<string, mixed>  $tasks  config('llm.tasks')
     * @param  array<string, int>  $timeouts  config('llm.timeouts') v ms
     */
    public function __construct(
        private readonly string $baseUrl,
        private readonly string $chatModel,
        private readonly string $embedModel,
        private readonly array $models = [],
        private readonly array $tasks = [],
        private readonly array $timeouts = [],
        private readonly string $keepAlive = '30m',
        private readonly int $healthTtl = 15,
    ) {}

    public function chat(array $messages, ChatOptions $opts): ChatResult
    {
        $task = $this->taskConfig($opts->task);
        $model = $this->resolveModel($opts, $task);
        $started = microtime(true);

        try {
            $response = $this->client($this->totalMs($opts))
                ->post($this->url('/api/chat'), $this->payload($messages, $opts, $task, $model, stream: false));

            if (! $response->successful()) {
                return ChatResult::failed($model, $this->httpError($response->status()));
            }

            /** @var array<string, mixed> $body */
            $body = (array) $response->json();

            if (isset($body['error'])) {
                return ChatResult::failed($model, 'Ollama odmietla požiadavku');
            }

            $text = (string) (data_get($body, 'message.content') ?? '');

            if ($text === '') {
                return ChatResult::failed($model, 'model nevrátil žiadny obsah');
            }

            return $this->result($text, $model, $body, $started, (string) ($body['done_reason'] ?? 'stop'));
        } catch (Throwable $e) {
            return ChatResult::failed($model, $this->safeReason($e));
        }
    }

    public function stream(array $messages, ChatOptions $opts, callable $onDelta): ChatResult
    {
        $task = $this->taskConfig($opts->task);
        $model = $this->resolveModel($opts, $task);
        $started = microtime(true);
        $text = '';
        /** @var array<string, mixed> $final */
        $final = [];

        try {
            $response = $this->client($this->totalMs($opts), stream: true)
                ->post($this->url('/api/chat'), $this->payload($messages, $opts, $task, $model, stream: true));

            if (! $response->successful()) {
                return ChatResult::failed($model, $this->httpError($response->status()));
            }

            $body = $response->toPsrResponse()->getBody();
            $buffer = '';

            while (! $body->eof()) {
                $chunk = $body->read(8192);

                if ($chunk === '') {
                    // Prázdne čítanie na neuzavretom prúde. Transfer ukončí cURL
                    // low-speed guard (idle timeout), tu len neblokujeme cyklus.
                    continue;
                }

                $buffer .= $chunk;

                // NDJSON: jeden JSON objekt na riadok, posledný riadok môže byť neúplný.
                while (($nl = strpos($buffer, "\n")) !== false) {
                    $line = trim(substr($buffer, 0, $nl));
                    $buffer = substr($buffer, $nl + 1);

                    if ($line === '') {
                        continue;
                    }

                    $frame = json_decode($line, true);
                    if (! is_array($frame)) {
                        continue;
                    }

                    if (isset($frame['error'])) {
                        return ChatResult::failed($model, 'Ollama odmietla požiadavku');
                    }

                    $delta = (string) (data_get($frame, 'message.content') ?? '');
                    if ($delta !== '') {
                        $text .= $delta;
                        $onDelta($delta);
                    }

                    if (($frame['done'] ?? false) === true) {
                        $final = $frame;
                    }
                }
            }

            if ($text === '') {
                return ChatResult::failed($model, 'model nevrátil žiadny obsah');
            }

            return $this->result($text, $model, $final, $started, (string) ($final['done_reason'] ?? 'stop'));
        } catch (Throwable $e) {
            // Čiastočne prijatý text je platný výsledok — používateľ ho už vidí.
            if ($text !== '') {
                return $this->result($text, $model, $final, $started, 'aborted');
            }

            return ChatResult::failed($model, $this->safeReason($e));
        }
    }

    /**
     * Embeddingy z bge-m3. Vracia NATÍVNU dimenziu modelu (1024) — `$opts->dimensions`
     * je len informácia pre volajúceho, provider nikdy nekráti ani nedopĺňa.
     *
     * @param  list<string>  $texts
     * @return list<list<float>>
     */
    public function embed(array $texts, EmbedOptions $opts): array
    {
        $texts = array_values(array_filter(array_map('strval', $texts), fn (string $t) => $t !== ''));
        if ($texts === []) {
            return [];
        }

        $model = $opts->model ?? $this->embedModel;

        try {
            $response = $this->client((int) ($this->timeouts['total'] ?? 300_000))
                ->post($this->url('/api/embed'), [
                    'model' => $model,
                    'input' => $texts,
                    'keep_alive' => $this->keepAlive,
                ]);

            if (! $response->successful()) {
                return [];
            }

            $vectors = $response->json('embeddings');
            if (! is_array($vectors) || count($vectors) !== count($texts)) {
                return [];
            }

            $out = [];
            foreach ($vectors as $vector) {
                if (! is_array($vector) || $vector === []) {
                    return [];
                }
                $out[] = array_map('floatval', array_values($vector));
            }

            return $out;
        } catch (Throwable) {
            // Nedostupný embedding = vektorová vetva recallu sa vynechá BEZ chyby.
            return [];
        }
    }

    public function health(): ProviderHealth
    {
        $ttl = max(0, $this->healthTtl);

        if ($ttl === 0) {
            return $this->probeHealth();
        }

        try {
            /** @var array<string, mixed> $cached */
            $cached = Cache::remember(
                'llm.ollama.health.'.md5($this->baseUrl),
                $ttl,
                fn () => $this->toCache($this->probeHealth()),
            );

            return $this->fromCache($cached);
        } catch (Throwable) {
            // Nedostupná cache nesmie zhodiť health check.
            return $this->probeHealth();
        }
    }

    public function name(): string
    {
        return 'ollama';
    }

    private function probeHealth(): ProviderHealth
    {
        $started = microtime(true);

        try {
            $response = $this->client((int) ($this->timeouts['connect'] ?? 5_000))->get($this->url('/api/tags'));

            if (! $response->successful()) {
                return ProviderHealth::down('Ollama nie je dostupná');
            }

            $models = [];
            foreach ((array) $response->json('models', []) as $entry) {
                $tag = is_array($entry) ? (string) ($entry['model'] ?? $entry['name'] ?? '') : '';
                if ($tag !== '') {
                    $models[] = $tag;
                }
            }

            $chat = $this->hasModel($models, $this->chatModel);
            $embed = $this->hasModel($models, $this->embedModel);

            return new ProviderHealth(
                ok: $chat || $embed,
                chat: $chat,
                embed: $embed,
                models: $models,
                latencyMs: (int) round((microtime(true) - $started) * 1000),
                error: $chat || $embed ? null : 'žiadny z nastavených modelov nie je stiahnutý',
            );
        } catch (Throwable) {
            return ProviderHealth::down('Ollama nie je dostupná');
        }
    }

    /**
     * Ollama hlási tagy vrátane `:latest`, config ich písať nemusí.
     *
     * @param  list<string>  $models
     */
    private function hasModel(array $models, string $wanted): bool
    {
        if ($wanted === '') {
            return false;
        }

        foreach ($models as $tag) {
            if ($tag === $wanted || $tag === $wanted.':latest' || str_starts_with($tag, $wanted.':')) {
                return true;
            }
        }

        return false;
    }

    /** @return array<string, mixed> */
    private function taskConfig(?string $task): array
    {
        $config = $this->tasks[$task ?? ''] ?? null;

        return is_array($config) ? $config : [];
    }

    /** @param  array<string, mixed>  $task */
    private function resolveModel(ChatOptions $opts, array $task): string
    {
        if (is_string($opts->model) && $opts->model !== '') {
            return $opts->model;
        }

        $key = (string) ($task['model'] ?? '');
        $fromMap = (string) ($this->models[$key] ?? '');

        return $fromMap !== '' ? $fromMap : $this->chatModel;
    }

    /**
     * @param  array<int, array{role: string, content: string}>  $messages
     * @param  array<string, mixed>  $task
     * @return array<string, mixed>
     */
    private function payload(array $messages, ChatOptions $opts, array $task, string $model, bool $stream): array
    {
        if (is_string($opts->system) && $opts->system !== '') {
            array_unshift($messages, ['role' => 'system', 'content' => $opts->system]);
        }

        $options = [
            'temperature' => (float) ($task['temperature'] ?? $opts->temperature),
            'num_predict' => (int) ($task['num_predict'] ?? $opts->maxTokens),
        ];

        if (isset($task['num_ctx'])) {
            $options['num_ctx'] = (int) $task['num_ctx'];
        }
        if ($opts->stop !== []) {
            $options['stop'] = array_values($opts->stop);
        }

        $payload = [
            'model' => $model,
            'messages' => array_values(array_map(
                fn (array $m) => ['role' => (string) $m['role'], 'content' => (string) $m['content']],
                $messages,
            )),
            'stream' => $stream,
            'keep_alive' => $this->keepAlive,
            'options' => $options,
        ];

        // POVINNÉ pri qwen3: bez `think:false` spáli celý budget na <think> blok.
        if (array_key_exists('think', $task)) {
            $payload['think'] = (bool) $task['think'];
        }
        if (isset($task['format']) && $task['format'] !== '') {
            $payload['format'] = $task['format'];
        }

        return $payload;
    }

    private function client(int $totalMs, bool $stream = false): PendingRequest
    {
        // Desatinné sekundy, nie celé: `max(1, round(ms/1000))` mal podlahu 1 s, takže
        // sub-sekundový connect timeout z configu by sa ticho zahodil a 300 ms by sa
        // chovalo ako 1 000 ms.
        $connect = max(0.05, ((int) ($this->timeouts['connect'] ?? 5_000)) / 1000);
        $idle = max(1, (int) round(((int) ($this->timeouts['idle'] ?? 30_000)) / 1000));

        $options = ['connect_timeout' => $connect];

        // Idle timeout patrí VÝHRADNE streamovanej vetve.
        //
        // Pri `stream: false` Ollama neposiela ani bajt, kým generovanie nedokončí —
        // takže „priepustnosť pod 1 B/s" je normálny stav celého čakania, nie porucha.
        // Keď sa low-speed voľby nastavili aj tu, cURL transfer po 30 sekundách zabil,
        // `safeReason()` chybu prepísal na „Ollama nie je dostupná" (hoci bežala) a
        // odpoveď ticho spadla na šablónu. Rozpočty `first_token` (90 s) a `total`
        // (300 s) boli na tejto vetve nedosiahnuteľné. Maskované ako výpadok modelu,
        // čo je najhorší druh chyby.
        //
        // Non-stream vetvu ohraničuje `->timeout($totalMs)` nižšie, a to je správna
        // hranica: bez streamovania „prvý token" neexistuje, celá odpoveď príde naraz,
        // takže jediné zmysluplné obmedzenie je celkový čas. 30 sekúnd je pre 4B model
        // na CPU normálny čas odpovede, nie porucha.
        if ($stream) {
            $options['stream'] = true;
            $options['read_timeout'] = $idle;

            // Konštanty sú strážené — bez rozšírenia curl by neexistovali.
            if (defined('CURLOPT_LOW_SPEED_LIMIT') && defined('CURLOPT_LOW_SPEED_TIME')) {
                $options['curl'] = [
                    CURLOPT_LOW_SPEED_LIMIT => 1,
                    CURLOPT_LOW_SPEED_TIME => $idle,
                ];
            }
        }

        return Http::withOptions($options)
            ->timeout(max(1, (int) round($totalMs / 1000)))
            ->acceptJson();
    }

    private function totalMs(ChatOptions $opts): int
    {
        $total = (int) ($this->timeouts['total'] ?? 300_000);

        return min($total, max(1_000, $opts->timeoutMs));
    }

    /** @param  array<string, mixed>  $body */
    private function result(string $text, string $model, array $body, float $started, string $finishReason): ChatResult
    {
        $completion = (int) ($body['eval_count'] ?? 0);
        $evalNs = (int) ($body['eval_duration'] ?? 0);

        return new ChatResult(
            text: $text,
            model: (string) ($body['model'] ?? $model),
            promptTokens: (int) ($body['prompt_eval_count'] ?? 0),
            completionTokens: $completion,
            ms: (int) round((microtime(true) - $started) * 1000),
            tokPerS: $evalNs > 0 && $completion > 0 ? round($completion / ($evalNs / 1e9), 2) : 0.0,
            finishReason: $this->normalizeFinishReason($finishReason),
        );
    }

    private function normalizeFinishReason(string $reason): string
    {
        return match ($reason) {
            'length', 'aborted' => $reason,
            default => 'stop',
        };
    }

    private function httpError(int $status): string
    {
        return match (true) {
            $status === 404 => 'model nie je stiahnutý',
            $status >= 500 => 'Ollama vrátila chybu servera',
            default => 'Ollama odmietla požiadavku',
        };
    }

    /** Text výnimky sa nikdy neposiela klientovi — môže obsahovať URL aj hlavičky. */
    private function safeReason(Throwable $e): string
    {
        return $e instanceof ConnectionException
            ? 'Ollama nie je dostupná'
            : 'volanie modelu zlyhalo';
    }

    /** @return array<string, mixed> */
    private function toCache(ProviderHealth $h): array
    {
        return [
            'ok' => $h->ok, 'chat' => $h->chat, 'embed' => $h->embed,
            'models' => $h->models, 'latencyMs' => $h->latencyMs, 'error' => $h->error,
        ];
    }

    /** @param  array<string, mixed>  $c */
    private function fromCache(array $c): ProviderHealth
    {
        return new ProviderHealth(
            ok: (bool) ($c['ok'] ?? false),
            chat: (bool) ($c['chat'] ?? false),
            embed: (bool) ($c['embed'] ?? false),
            models: array_values(array_map('strval', (array) ($c['models'] ?? []))),
            latencyMs: isset($c['latencyMs']) ? (int) $c['latencyMs'] : null,
            error: isset($c['error']) ? (string) $c['error'] : null,
        );
    }

    private function url(string $path): string
    {
        return rtrim($this->baseUrl, '/').$path;
    }
}
