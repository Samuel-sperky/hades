<?php

namespace App\Services\Llm;

/**
 * Neznáme meno poskytovateľa v `hades.console.provider`.
 *
 * Prečo výnimka a nie tichý fallback na default: preklep v `.env`
 * (`HADES_CONSOLE_PROVIDER=olama`) by pri fallbacku znamenal, že konzola beží,
 * odpovedá a nikto sa nedozvie, že beží na inom modeli, než si obsluha myslí.
 * Pri lokálnom modeli je rozdiel v odpovediach dosť veľký, aby to bolo drahé
 * ladenie. Radšej hlasné zlyhanie pri štarte.
 */
class UnknownProviderException extends LlmException
{
    /**
     * @param  list<string>  $known
     */
    public function __construct(string $name, array $known)
    {
        parent::__construct(sprintf(
            'Neznámy poskytovateľ jazyka „%s“. Nastav HADES_CONSOLE_PROVIDER na jedno z: %s.',
            $name,
            implode(', ', $known),
        ));
    }
}
