<?php

namespace App\Services\Llm;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Lokálny model cez Ollamu (`POST /api/chat`).
 *
 * Toto je default poskytovateľ konzoly: stroj pod appkou má 24 CPU jadier a
 * ŽIADNU použiteľnú GPU, takže inferencia beží na CPU a každý token kontextu má
 * cenu. Preto sa `num_ctx` berie z configu a nie z defaultu Ollamy.
 *
 * Mapovanie odpovede žije celé v {@see OllamaStreamParser} — aj pre
 * nestreamovaný ťah, ktorý je len NDJSON s jediným riadkom. Dve cesty mapovania
 * by sa časom rozišli a chyba by sa ukázala len na jednej z nich.
 */
class OllamaProvider implements LlmProvider
{
    public const NAME = 'ollama';

    /**
     * Zdravotná sonda si nesmie vziať `hades.console.ollama.timeout` (900 s).
     * Ten strop je na dlhý prvý token na CPU; keby na ňom viselo `available()`,
     * vykreslenie konzoly by pri zhasnutej Ollame čakalo pätnásť minút.
     */
    private const PROBE_TIMEOUT = 3;

    public function name(): string
    {
        return self::NAME;
    }

    public function available(): bool
    {
        try {
            return Http::timeout(self::PROBE_TIMEOUT)
                ->get($this->url('/api/tags'))
                ->successful();
        } catch (Throwable) {
            // Kontrakt: `available()` nehádže. Nedostupný server je odpoveď.
            return false;
        }
    }

    public function models(): array
    {
        try {
            $response = Http::timeout(self::PROBE_TIMEOUT)->get($this->url('/api/tags'));
        } catch (Throwable) {
            return [];
        }

        if (! $response->successful()) {
            return [];
        }

        $models = [];

        foreach ($response->json('models') ?? [] as $entry) {
            // `model` je identifikátor na volanie, `name` to isté v starších
            // verziách — bez fallbacku by starší server hlásil prázdny zoznam.
            $id = $entry['model'] ?? $entry['name'] ?? null;

            if (is_string($id) && $id !== '') {
                $models[] = $id;
            }
        }

        return array_values(array_unique($models));
    }

    public function chat(array $messages, array $options = []): LlmResponse
    {
        return $this->run($messages, $options, null);
    }

    public function stream(array $messages, array $options, callable $onDelta): LlmResponse
    {
        return $this->run($messages, $options, $onDelta);
    }

    /**
     * @param  list<array<string, mixed>>  $messages
     * @param  array<string, mixed>  $options
     * @param  (callable(string): void)|null  $onDelta
     */
    protected function run(array $messages, array $options, ?callable $onDelta): LlmResponse
    {
        $streaming = $onDelta !== null;
        $parser = new OllamaStreamParser($onDelta);
        $startedAt = hrtime(true);

        try {
            $response = Http::withOptions($streaming ? ['stream' => true] : [])
                ->timeout((int) config('hades.console.ollama.timeout', 900))
                ->acceptJson()
                ->post($this->url('/api/chat'), $this->payload($messages, $options, $streaming));
        } catch (ConnectionException) {
            throw new ProviderUnavailableException(
                self::NAME,
                'server na '.$this->host().' neodpovedá (beží Ollama?)',
            );
        } catch (Throwable $e) {
            throw ProviderRequestException::from(self::NAME, $e);
        }

        if ($response->failed()) {
            throw new ProviderRequestException(
                'Ollama odpovedala HTTP '.$response->status().'.',
            );
        }

        $body = $response->toPsrResponse()->getBody();

        // Číta sa po kusoch, aby `$onDelta` dostal text priebežne. Pod
        // `Http::fake()` je telo v pamäti celé, takže deltá prídu naraz — a to je
        // presne dôvod, prečo poradie deltov testuje parser sám, nie tento kód.
        while (! $body->eof()) {
            $chunk = $body->read(8192);

            if ($chunk === '') {
                break;
            }

            $parser->feed($chunk);
        }

        $parser->finish();

        if (! $parser->sawDone()) {
            // Bez objektu s `done: true` je ťah odseknutý v polovici. Vrátiť ho
            // ako hotový by znamenalo, že smyčka pokračuje nad polovičnou
            // odpoveďou a nikto sa nedozvie, že sa niečo stratilo.
            throw new ProviderRequestException('Ollama pretrhla stream pred dokončením ťahu.');
        }

        return $parser->response(intdiv(hrtime(true) - $startedAt, 1_000_000));
    }

    /**
     * @param  list<array<string, mixed>>  $messages
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    protected function payload(array $messages, array $options, bool $streaming): array
    {
        $payload = [
            'model' => (string) ($options['model'] ?? config('hades.console.ollama.model')),
            'messages' => $this->encodeMessages($messages, $options['system'] ?? null),
            'stream' => $streaming,
            'options' => array_filter([
                'num_ctx' => (int) config('hades.console.ollama.context', 16384),
                'temperature' => $options['temperature'] ?? null,
                'num_predict' => $options['max_tokens'] ?? null,
            ], fn ($value) => $value !== null),
        ];

        $tools = $this->encodeTools($options['tools'] ?? []);

        if ($tools !== []) {
            $payload['tools'] = $tools;
        }

        // `think` sa posiela len keď o ňom volajúci vyslovene rozhodol: qwen3 má
        // uvažovanie zapnuté defaultne a na CPU je to najdrahšia časť ťahu, ale
        // vypnúť ho za volajúceho by mu zhoršilo kvalitu bez toho, aby o tom vedel.
        if (array_key_exists('think', $options)) {
            $payload['think'] = (bool) $options['think'];
        }

        return $payload;
    }

    /**
     * Kanonické správy → tvar Ollamy.
     *
     * `/api/chat` nemá parameter pre systémový prompt, ide ako prvá správa s
     * rolou `system`. Výsledok toolu ide ako správa s rolou `tool`; `tool_name`
     * Ollama používa na priradenie, `tool_call_id` nepozná — páruje si to
     * poradím, takže id sa sem zámerne neposiela.
     *
     * @param  list<array<string, mixed>>  $messages
     * @return list<array<string, mixed>>
     */
    protected function encodeMessages(array $messages, ?string $system): array
    {
        $encoded = [];

        if (is_string($system) && trim($system) !== '') {
            $encoded[] = ['role' => 'system', 'content' => $system];
        }

        foreach ($messages as $message) {
            $role = (string) ($message['role'] ?? 'user');
            $content = (string) ($message['content'] ?? '');

            if ($role === 'tool') {
                $entry = ['role' => 'tool', 'content' => $content];

                $name = (string) ($message['tool_name'] ?? '');

                if ($name !== '') {
                    $entry['tool_name'] = $name;
                }

                $encoded[] = $entry;

                continue;
            }

            $entry = ['role' => $role, 'content' => $content];
            $calls = $this->encodeToolCalls(
                is_array($message['tool_calls'] ?? null) ? $message['tool_calls'] : [],
            );

            if ($calls !== []) {
                $entry['tool_calls'] = $calls;
            }

            $encoded[] = $entry;
        }

        return $encoded;
    }

    /**
     * @param  iterable<mixed>  $calls
     * @return list<array<string, mixed>>
     */
    protected function encodeToolCalls(iterable $calls): array
    {
        $encoded = [];

        foreach ($calls as $call) {
            if ($call instanceof LlmToolCall) {
                $name = $call->name;
                $arguments = $call->arguments;
            } elseif (is_array($call)) {
                $name = (string) ($call['name'] ?? '');
                $arguments = LlmToolCall::decodeArguments($call['arguments'] ?? []);
            } else {
                continue;
            }

            if ($name === '') {
                continue;
            }

            // Prázdne argumenty musia ísť ako `{}`, nie `[]`: `json_encode`
            // prázdne PHP pole serializuje na `[]` a server to odmietne, lebo
            // `arguments` je objekt.
            $encoded[] = [
                'function' => [
                    'name' => $name,
                    'arguments' => $arguments === [] ? new \stdClass : $arguments,
                ],
            ];
        }

        return $encoded;
    }

    /**
     * Kanonické definície toolov → tvar Ollamy (`type: function`).
     *
     * Prijíma aj `parameters` namiesto `input_schema` a aj už zabalený
     * `['type' => 'function', 'function' => …]`, aby volajúci nemusel vedieť,
     * na ktorého poskytovateľa práve hovorí.
     *
     * @param  iterable<mixed>  $tools
     * @return list<array<string, mixed>>
     */
    protected function encodeTools(iterable $tools): array
    {
        $encoded = [];

        foreach ($tools as $tool) {
            if (! is_array($tool)) {
                continue;
            }

            if (isset($tool['function']) && is_array($tool['function'])) {
                $encoded[] = ['type' => 'function', 'function' => $tool['function']];

                continue;
            }

            $name = (string) ($tool['name'] ?? '');

            if ($name === '') {
                continue;
            }

            $schema = $tool['input_schema'] ?? $tool['parameters'] ?? ['type' => 'object'];

            $encoded[] = [
                'type' => 'function',
                'function' => array_filter([
                    'name' => $name,
                    'description' => $tool['description'] ?? null,
                    'parameters' => is_array($schema) ? $schema : ['type' => 'object'],
                ], fn ($value) => $value !== null),
            ];
        }

        return $encoded;
    }

    protected function host(): string
    {
        return rtrim((string) config('hades.console.ollama.host', 'http://ollama:11434'), '/');
    }

    protected function url(string $path): string
    {
        return $this->host().$path;
    }
}
