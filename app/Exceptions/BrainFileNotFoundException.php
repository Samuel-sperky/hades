<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * Update/delete/verify nedokázal nájsť zdrojový `.md` súbor uzla — buď uzol nemá
 * stopu do súboru (`meta.root`/`source_file`), alebo súbor medzičasom zmizol.
 * Spusti `mind:brain-sync` a skús znova.
 */
class BrainFileNotFoundException extends RuntimeException
{
    public function __construct(string $sourceFile)
    {
        parent::__construct(
            "Zdrojový súbor uzla ({$sourceFile}) sa nenašiel — súbor sa medzičasom zmenil alebo zmizol. "
            .'Spusti mind:brain-sync a skús to znova.'
        );
    }
}
