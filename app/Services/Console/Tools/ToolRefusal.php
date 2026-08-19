<?php

namespace App\Services\Console\Tools;

use App\Services\Console\ToolRegistry;
use RuntimeException;

/**
 * Tool odmietol argumenty — cesta mimo koreňa, nejednoznačný `old_string`,
 * label, ktorý je v skutočnosti surový prompt.
 *
 * Prečo výnimka a nie návratová hodnota: odmietnutie sa deje hlboko vo validácii
 * (PathGuard, noise-check) a každá vrstva nad ním by musela návratovú hodnotu
 * podávať ďalej. {@see ToolRegistry::call()} to zachytí
 * na jednom mieste a preloží na `ToolResult::refused()`, takže model vždy
 * dostane vetu, z ktorej sa dá pokračovať.
 *
 * Správa ide MODELU, preto je anglicky a preto vždy hovorí, čo urobiť inak.
 * Nikdy nesmie obsahovať obsah, ktorý sa odmieta (mohlo by to byť tajomstvo).
 */
class ToolRefusal extends RuntimeException {}
