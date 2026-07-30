<?php

namespace App\Services\Sperky\Exceptions;

use RuntimeException;

/**
 * Základ pre všetky chyby SPERKY integrácie.
 *
 * ŽELEZNÉ PRAVIDLO: v správe ani v kontexte tejto výnimky NIKDY nesmie byť API
 * kľúč — ani jeho časť. Preto sa správy skladajú len z konštánt tejto triedy a
 * z whitelistovaných kódov, nikdy z hlavičiek požiadavky, z URL s parametrami
 * ani zo surového tela odpovede. Rovnaké pravidlo platí pre logy: `context()`
 * je jediné, čo sa smie zapísať.
 *
 * Pôvodná výnimka sa ZÁMERNE nepripája ako `previous` — správa transportnej
 * výnimky môže obsahovať celú požiadavku vrátane hlavičiek.
 */
abstract class SperkyException extends RuntimeException
{
    /**
     * @param  string  $errorCode  strojový kód z whitelistu (nikdy surový text z odpovede)
     */
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly ?int $httpStatus = null,
    ) {
        parent::__construct($message);
    }

    /** Je chyba na strane e-shopu/siete (true), alebo v našej požiadavke (false)? */
    abstract public function isInfrastructure(): bool;

    /**
     * Bezpečný kontext pre log a pre API odpoveď. Obsahuje výhradne strojové
     * kódy — žiadnu URL, žiadne hlavičky, žiadne telo odpovede.
     *
     * @return array<string, mixed>
     */
    public function context(): array
    {
        return [
            'code' => $this->errorCode,
            'http_status' => $this->httpStatus,
            'infrastructure' => $this->isInfrastructure(),
        ];
    }
}
