<?php

namespace App\Services\Console;

use RuntimeException;

/**
 * Podagent sa zaparkoval na povolení zápisu — a rodičovský ťah preto končí tiež.
 *
 * Súrodenec {@see RunAborted}: výnimka ako riadiaci signál smyčky, nie chyba.
 * Dôvod, prečo to nie je návratová hodnota, je ale iný. `spawn_agent` je z
 * pohľadu {@see ToolRegistry::call()} obyčajný tool a jeho jediný výstup je
 * {@see ToolResult} — teda text, ktorý sa vráti MODELU. Zaparkovaný podagent ale
 * ešte nič nepovedal, takže niet čo vrátiť: keby tool vrátil `ToolResult`, smyčka
 * by ho zapísala ako výsledok, model by na základe prázdnej odpovede pokračoval a
 * ťah by dobehol rámcom `end` — kým dieťa stále čaká na človeka. Výnimka je
 * jediná cesta, ako z toolu vyjsť BEZ výsledku.
 *
 * Chytá ju {@see AgentRunner::drain()} a priamy `executeCall()` v
 * {@see AgentRunner::resume()}: obidva vrátia `spawn_agent` call rodiča do stavu
 * `pending` a ťah skončí bez rámca `end`. Rámec `agent_wait` už vydal
 * {@see \App\Services\Console\Tools\SpawnAgentTool} pred hodením — vydávať ho tu
 * by znamenalo, že o parkovaní hovoria dve miesta.
 *
 * Rámec `error` sa neposiela: ťah nespadol, čaká.
 */
final class AgentParked extends RuntimeException {}
