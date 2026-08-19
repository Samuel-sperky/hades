<?php

namespace App\Services\Llm;

/**
 * Jeden kontrakt, ktorý spĺňa lokálny model v Ollame aj Claude v cloude.
 *
 * Prečo to takto: konzola vedomia (`/console`) beží ako agentová smyčka nad
 * vlastnými toolmi. Keby volala SDK priamo — ako to dodnes robí
 * `ChatController` s pevne zadrôtovaným modelom — výmena modelu by znamenala
 * prepísať smyčku. Stroj pod tým nemá použiteľnú GPU,
 * takže lokálny model je pomalý a experimentovanie s ním je nevyhnutné; vrstva
 * existuje preto, aby ten experiment nestál nič.
 *
 * ── Kanonický tvar správ (`$messages`) ───────────────────────────────────────
 *
 * Volajúci hovorí jedným jazykom, prekladá si ho poskytovateľ:
 *
 *   ['role' => 'user',      'content' => 'text']
 *   ['role' => 'assistant', 'content' => 'text', 'tool_calls' => [LlmToolCall, …]]
 *   ['role' => 'tool',      'tool_call_id' => 'id', 'tool_name' => 'meno',
 *                           'content' => 'výsledok toolu']
 *
 * `tool_calls` prijíma {@see LlmToolCall} aj pole `['id','name','arguments']` —
 * história vlákna sa do DB ukladá ako JSON a po prečítaní je z nej pole, nie
 * objekt. Nútiť volajúceho rehydratovať VO len preto, aby ho vrstva rozobrala,
 * je práca za nič.
 *
 * Rola `tool` sa u každého poskytovateľa preloží inak (Ollama: správa s rolou
 * `tool`; Anthropic: `user` správa s blokmi `tool_result`) a to je práve dôvod,
 * prečo tento kontrakt existuje.
 *
 * ── Voľby (`$options`) ───────────────────────────────────────────────────────
 *
 *   'system'      string        systémový prompt
 *   'tools'       array         definície toolov v JSON-schema tvare:
 *                               ['name' =>, 'description' =>, 'input_schema' =>]
 *                               ('parameters' sa berie ako synonym pre
 *                               'input_schema' — tak ich pomenúva Ollama)
 *   'model'       string        prebije default z configu
 *   'temperature' float
 *   'max_tokens'  int
 *
 * Nepoznané voľby sa ignorujú, nie odmietajú: každý poskytovateľ má vlastné
 * ladiace parametre a strop na ne by znamenal meniť interface pri každom novom.
 */
interface LlmProvider
{
    /** Meno pod ktorým poskytovateľa vydá {@see ProviderFactory} (`ollama`, `anthropic`). */
    public function name(): string;

    /**
     * Modely, ktoré sú SKUTOČNE k dispozícii — nie zoznam, o ktorom si appka
     * myslí, že platí. Ollama sa preto pýta `GET /api/tags`: modely na tomto
     * stroji sa doťahujú za chodu a zoznam v configu by starol.
     *
     * @return list<string>
     */
    public function models(): array;

    /**
     * Vie tento poskytovateľ práve teraz odpovedať? Ollama: beží server.
     * Anthropic: je vyplnený API kľúč.
     *
     * Nikdy nehodí výnimku — volá sa aj pri vykreslení UI, kde je odpoveď
     * „nedostupný“ legitímna informácia, nie chyba.
     */
    public function available(): bool;

    /**
     * Jeden ťah bez streamovania.
     *
     * @param  list<array<string, mixed>>  $messages
     * @param  array<string, mixed>  $options
     *
     * @throws LlmException keď poskytovateľ nie je dostupný alebo request zlyhal
     */
    public function chat(array $messages, array $options = []): LlmResponse;

    /**
     * Jeden ťah so streamovaním. `$onDelta` dostane každý kúsok textu tak, ako
     * priteká; návratová hodnota je ten istý celok ako z {@see self::chat()},
     * takže smyčka nemusí deltá skladať sama.
     *
     * Volania toolov sa cez `$onDelta` NEposielajú — do UI ide len text a tool
     * je udalosť, nie text.
     *
     * @param  list<array<string, mixed>>  $messages
     * @param  array<string, mixed>  $options
     * @param  callable(string): void  $onDelta
     *
     * @throws LlmException keď poskytovateľ nie je dostupný alebo request zlyhal
     */
    public function stream(array $messages, array $options, callable $onDelta): LlmResponse;
}
