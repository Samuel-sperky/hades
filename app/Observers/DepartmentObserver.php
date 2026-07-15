<?php

namespace App\Observers;

use App\Models\Department;
use App\Services\MindMirror;

/**
 * Premenovanie (zmena slugu) alebo zmazanie oddelenia mení cesty priečinkov.
 * Je to zriedkavá štrukturálna zmena — spoľahlivo ju vyriešime plnou regeneráciou.
 */
class DepartmentObserver
{
    public function __construct(protected MindMirror $mirror) {}

    public function saved(Department $department): void
    {
        // Nove oddelenie nema uzly na presun — rebuild len pri premenovani slugu.
        if (! $department->wasRecentlyCreated && $department->wasChanged('slug')) {
            $this->mirror->rebuild();
        }
    }

    public function deleted(Department $department): void
    {
        $this->mirror->rebuild();
    }
}
