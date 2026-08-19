<?php

namespace App\Services\Llm;

use RuntimeException;

/**
 * Základ pre zlyhania jazykovej vrstvy.
 *
 * Prečo vlastná hierarchia: konzola musí vedieť rozlíšiť „poskytovateľ nie je
 * nastavený“ (chyba obsluhy, ukáž návod) od „request zlyhal“ (chyba behu, skús
 * znova) — a nesmie na to čítať typy z cudzieho SDK. Anthropic SDK má vlastnú
 * rodinu výnimiek, Ollama žiadnu, a keby smyčka chytala tie, výmena
 * poskytovateľa by ju znovu rozbila.
 */
class LlmException extends RuntimeException {}
