<?php

namespace App\Observers;

use App\Models\Edge;
use App\Services\MindMirror;

class EdgeObserver
{
    public function __construct(protected MindMirror $mirror) {}

    public function saved(Edge $edge): void
    {
        $this->mirror->exportById($edge->source_id);
        $this->mirror->exportById($edge->target_id);
    }

    public function deleted(Edge $edge): void
    {
        $this->mirror->exportById($edge->source_id);
        $this->mirror->exportById($edge->target_id);
    }
}
