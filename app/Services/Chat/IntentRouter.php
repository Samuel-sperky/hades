<?php

namespace App\Services\Chat;

/**
 * VRSTVA 1 — deterministický router zámeru. POVINNÁ a prvá. Vlastník P5.
 *
 * Zdroj pravdy: kľúčové slová + regex na čísla z `config('prompts.router_rules')`.
 * Funguje bez modelu, bez Ollamy a offline.
 *
 * Prečo nie model: meranie (docs/BENCHMARK-LLM.md §2) ukázalo, že `qwen3:0.6b`
 * má 25 % presnosť a takmer všetko zhodí na `none`. Model je preto len doplnok
 * (ModelIntentRouter) pre prípad, keď tu nič netrafí.
 */
final class IntentRouter
{
    public function __construct(private readonly TextNormalizer $normalizer) {}

    /** Prvá zhoda v poradí pravidiel vyhráva; žiadna zhoda = 'none'. */
    public function route(string $message): Intent
    {
        $folded = $this->normalizer->fold($message);

        if ($folded === '') {
            return Intent::none();
        }

        foreach ($this->rules() as $rule) {
            $pattern = (string) ($rule['pattern'] ?? '');
            $intent = (string) ($rule['intent'] ?? '');

            if ($pattern === '' || $intent === '') {
                continue;
            }

            if (@preg_match($pattern, $folded, $matches) !== 1) {
                continue;
            }

            return new Intent($intent, $this->namedParams($matches), 'deterministic');
        }

        return Intent::none();
    }

    /**
     * Uzavretý enum tried — validácia výstupu vrstvy 2.
     *
     * @return list<string>
     */
    public function allowedIntents(): array
    {
        return array_values(array_map('strval', (array) config('prompts.intents', ['none'])));
    }

    /** @return list<array<string, string>> */
    private function rules(): array
    {
        $rules = config('prompts.router_rules', []);

        return is_array($rules) ? array_values(array_filter($rules, 'is_array')) : [];
    }

    /**
     * Z regexu berieme len pomenované grupy — číselné indexy by do parametrov
     * priniesli celý zložený dopyt.
     *
     * @param  array<int|string, string>  $matches
     * @return array<string, string>
     */
    private function namedParams(array $matches): array
    {
        $params = [];

        foreach ($matches as $key => $value) {
            if (is_string($key) && is_string($value) && trim($value) !== '') {
                $params[$key] = trim($value);
            }
        }

        return $params;
    }
}
