<?php

namespace App\Observers;

use App\Models\Area;
use App\Services\MindMirror;

/**
 * Zmena slugu oblasti (alebo jej zmazanie) presúva celé podstromy priečinkov.
 * Zriedkavé — riešime plnou regeneráciou stromu `mind/`.
 */
class AreaObserver
{
    public function __construct(protected MindMirror $mirror) {}

    public function saved(Area $area): void
    {
        if ($area->wasChanged('slug')) {
            $this->mirror->rebuild();
        }
    }

    public function deleted(Area $area): void
    {
        $this->mirror->rebuild();
    }
}
