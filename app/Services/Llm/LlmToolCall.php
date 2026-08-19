<?php

namespace App\Services\Llm;

/**
 * Znormalizované volanie toolu — jeden tvar pre lokálnu Ollamu aj pre Claude.
 *
 * Prečo to takto: agentová smyčka konzoly nesmie vedieť, ktorý model odpovedal.
 * Keby si tool_calls čítala z odpovede sama, každá výmena modelu by znamenala
 * prepísať smyčku — presne to, čo táto vrstva existuje zabrániť.
 *
 * `arguments` je VŽDY dekódované PHP pole. Ollama posiela
 * `message.tool_calls[].function.arguments` už ako objekt (na rozdiel od
 * OpenAI-kompatibilných API, ktoré tam dávajú JSON string), Anthropic posiela
 * `tool_use.input` tiež ako objekt — ale pri streamovaní ho skladá z
 * `input_json_delta` chunkov, takže JSON string niekde v ceste existuje.
 * Preto {@see self::decodeArguments()}: volajúci dostane pole, alebo prázdne
 * pole, nikdy string a nikdy null.
 */
final readonly class LlmToolCall
{
    /**
     * @param  array<string, mixed>  $arguments
     */
    public function __construct(
        public string $id,
        public string $name,
        public array $arguments = [],
    ) {}

    /**
     * Argumenty toolu z čohokoľvek, čo poskytovateľ dodal.
     *
     * Pasca: prázdny objekt `{}` sa v JSON-e dekóduje na prázdne pole a prázdne
     * pole je rovnako platný vstup ako chýbajúci — tool bez parametrov nie je
     * chyba. Naopak neplatný JSON string chybou JE, ale hodiť tu výnimku by
     * zhodilo celý ťah kvôli jednému pokazenému toolu. Vráti sa prázdne pole a
     * tool si na chýbajúci povinný parameter zaplače sám, validáciou.
     *
     * @return array<string, mixed>
     */
    public static function decodeArguments(mixed $raw): array
    {
        if (is_array($raw)) {
            return $raw;
        }

        if (is_string($raw) && trim($raw) !== '') {
            $decoded = json_decode($raw, true);

            return is_array($decoded) ? $decoded : [];
        }

        if (is_object($raw)) {
            return (array) $raw;
        }

        return [];
    }
}
