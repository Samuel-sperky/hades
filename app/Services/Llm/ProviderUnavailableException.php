<?php

namespace App\Services\Llm;

/**
 * Poskytovateľ existuje, ale nie je pripravený odpovedať — chýba kľúč, alebo
 * server nebeží.
 *
 * Prečo zvlášť od {@see ProviderRequestException}: toto je chyba nastavenia a
 * opraví ju človek v `.env` alebo spustením Ollamy, nie opakovaný pokus. Konzola
 * podľa toho rozhoduje, či má ponúknuť „skús znova“ alebo návod.
 */
class ProviderUnavailableException extends LlmException
{
    public function __construct(string $provider, string $reason)
    {
        parent::__construct("Poskytovateľ „{$provider}“ nie je pripravený: {$reason}");
    }
}
