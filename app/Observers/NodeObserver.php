<?php

namespace App\Observers;

use App\Models\Edge;
use App\Models\Node;
use App\Services\MindMirror;

class NodeObserver
{
    /** Zachytení susedia uzla pred jeho zmazaním (kvôli obnove ich spojení). */
    protected static array $neighborStash = [];

    public function __construct(protected MindMirror $mirror) {}

    public function saved(Node $node): void
    {
        if ($node->wasRecentlyCreated) {
            $this->mirror->export($node);

            return;
        }

        // Update: ak sa zmenil label/oblasť/oddelenie/typ, treba presunúť súbor.
        $this->mirror->export($node, [
            'type' => $node->getOriginal('type'),
            'area_id' => $node->getOriginal('area_id'),
            'department_id' => $node->getOriginal('department_id'),
            'label' => $node->getOriginal('label'),
        ]);

        // Pri premenovaní obnov aj susedov — v ich zozname „Spojenia" je starý label.
        if ($node->wasChanged('label')) {
            foreach ($this->neighborIds($node) as $neighborId) {
                $this->mirror->exportById($neighborId);
            }
        }
    }

    protected function neighborIds(Node $node): array
    {
        return Edge::query()
            ->where('source_id', $node->id)
            ->orWhere('target_id', $node->id)
            ->get(['source_id', 'target_id'])
            ->flatMap(fn (Edge $e) => [$e->source_id, $e->target_id])
            ->reject(fn ($id) => $id === $node->id)
            ->unique()
            ->values()
            ->all();
    }

    public function deleting(Node $node): void
    {
        self::$neighborStash[$node->id] = $this->neighborIds($node);
    }

    public function deleted(Node $node): void
    {
        $this->mirror->forget($node);

        foreach (self::$neighborStash[$node->id] ?? [] as $neighborId) {
            $this->mirror->exportById($neighborId);
        }

        unset(self::$neighborStash[$node->id]);
    }
}
