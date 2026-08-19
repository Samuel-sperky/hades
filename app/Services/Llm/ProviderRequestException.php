<?php

namespace App\Services\Llm;

use Throwable;

/**
 * Request na model zlyhal — HTTP chyba, pretrhnutý stream, chyba z SDK.
 *
 * Prečo obal a nie surová výnimka z SDK: konzola chytá {@see LlmException}, nie
 * `Anthropic\Core\Exceptions\APIException`. Bez obalu by sa typ cudzieho SDK
 * dostal do agentovej smyčky a výmena poskytovateľa by ju rozbila — presne to,
 * čomu má táto vrstva zabrániť.
 *
 * Pôvodná výnimka ide do `previous`, teda do logu. Do textu správy sa NEkopíruje:
 * hlásenia z HTTP klienta nesú celú URL aj hlavičky requestu vrátane
 * `x-api-key`, a táto správa smie skončiť v odpovedi pre prehliadač.
 */
class ProviderRequestException extends LlmException
{
    public static function from(string $provider, Throwable $previous): self
    {
        return new self(
            "Model poskytovateľa „{$provider}“ neodpovedal. Detail je v logu.",
            0,
            $previous,
        );
    }
}
