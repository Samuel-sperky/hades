<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * SecretScanner našiel v texte vzory pripomínajúce tajomstvo. Nesie LEN NÁZVY
 * VZOROV — nikdy nie matched hodnotu (tá sa neloguje ani nevracia nikam). Zápis
 * sa dá povoliť explicitným druhým potvrdením (`force=true`) → z výnimky sa stane
 * varovanie.
 */
class SecretsDetectedException extends RuntimeException
{
    /**
     * @param  list<string>  $patterns  názvy vzorov (napr. "github-token")
     */
    public function __construct(public readonly array $patterns)
    {
        parent::__construct(
            'Text vyzerá, že obsahuje tajomstvo (vzory: '.implode(', ', $patterns).'). '
            .'Ulož len ak si istý, že ide o falošný poplach (force).'
        );
    }
}
