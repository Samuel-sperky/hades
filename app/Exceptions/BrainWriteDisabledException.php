<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * Tvrdý guard: Hades nikdy nezapíše do ľudsky písaného `.md` „mozgu", pokiaľ to
 * používateľ vedome nepovolí. Hodí ho každá mutačná operácia {@see \App\Services\Brain\BrainWriter}
 * keď `config('hades.allow_brain_write')` je false (fail-safe default OFF).
 */
class BrainWriteDisabledException extends RuntimeException
{
    public function __construct()
    {
        parent::__construct(
            'Zápis do mozgu je vypnutý (fail-safe default). Zapni ho vedome: '
            .'(1) HADES_ALLOW_BRAIN_WRITE=true v .env, '
            .'(2) mount zdroja musí byť zapisovateľný (writable), '
            .'(3) docker compose up -d.'
        );
    }
}
