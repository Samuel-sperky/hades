<?php

namespace App\Llm;

/**
 * ZAMKNUTÉ ROZHRANIE (#11) — nemení sa bez zápisu do CLAUDE.md.
 *
 * Konzumenti: P1 (embed pre vektorový recall), P3 (chat pre smartTitle/sumáre/digest),
 * P5 (implementuje všetkých providerov). Vlastník implementácií: A3.
 *
 * ŽELEZNÉ PRAVIDLO: ŽIADNA metóda nesmie vyhodiť výnimku pri nedostupnom modeli.
 * Nedostupnosť je normálny stav (Ollama nemusí bežať) a signalizuje sa návratovou
 * hodnotou — ChatResult s finishReason 'error', resp. ProviderHealth{ok: false}.
 * Rozhoduje volajúci, nie provider. Vďaka tomu je appka plne funkčná aj bez LLM.
 *
 * $messages je list<array{role: 'system'|'user'|'assistant', content: string}>.
 */
interface ChatProvider
{
    /** Jednorazová odpoveď. */
    public function chat(array $messages, ChatOptions $opts): ChatResult;

    /**
     * Streamovaná odpoveď. $onDelta(string $text) sa volá per chunk.
     * Vracia finálny výsledok (spojený text + metriky).
     */
    public function stream(array $messages, ChatOptions $opts, callable $onDelta): ChatResult;

    /**
     * @param  list<string>  $texts
     * @return list<list<float>>  vektory v ROVNAKOM poradí ako vstup;
     *                            prázdny list, keď embedding nie je dostupný
     */
    public function embed(array $texts, EmbedOptions $opts): array;

    public function health(): ProviderHealth;

    /** Stabilný strojový názov providera do llm_runs (napr. 'ollama', 'null'). */
    public function name(): string;
}
