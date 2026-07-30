<?php

namespace App\Services\Chat;

use App\Models\Activation;
use App\Models\Area;
use App\Models\Decision;
use App\Models\Department;
use App\Models\Edge;
use App\Models\Node;
use Illuminate\Support\Collection;

/**
 * VRSTVA 3 — šablónové odpovede. Vlastník P5.
 *
 * ŽELEZNÉ PRAVIDLO: čísla a fakty skladá VŽDY tento kód z reálnych dát
 * (recall, uzly, hrany, aktivácie, rozhodnutia). Model ich nikdy negeneruje.
 * Vrstva 3 je jediná POVINNÁ vrstva — funguje bez modelu a bez Ollamy.
 *
 * Text šablón je v `config/prompts.php`; tu sa dopĺňajú hodnoty a skladajú
 * zoznamy uzlov (markdown odrážky renderuje P6).
 */
final class TemplateAnswerer
{
    /** Koľko uzlov ide do zoznamu v odpovedi. */
    private const LIST_LIMIT = 6;

    /** Okno „nedávno" v dňoch pre memory.recent_work. */
    private const RECENT_DAYS = 14;

    public function __construct(
        private readonly RecallGateway $recall,
        private readonly TextNormalizer $normalizer,
    ) {}

    public function answer(Intent $intent, string $message, ?string $sessionKey = null): ChatAnswer
    {
        return match ($intent->name) {
            'memory.stats' => $this->stats($intent),
            'memory.decisions' => $this->decisions($intent),
            'memory.recent_work' => $this->recentWork($intent),
            'memory.skills_in_area' => $this->skillsInArea($intent, $message),
            'memory.project' => $this->project($intent, $message, $sessionKey),
            'memory.about' => $this->about($intent, $message, $sessionKey),
            default => $intent->isShop()
                ? $this->shopUnavailable($intent)
                : $this->fromRecall($intent, $message, $sessionKey),
        };
    }

    /** memory.stats — všetky čísla priamo z databázy. */
    private function stats(Intent $intent): ChatAnswer
    {
        $byType = Node::query()
            ->selectRaw('type, COUNT(*) AS total')
            ->groupBy('type')
            ->pluck('total', 'type');

        $text = $this->fill($this->template('memory.stats', 'hit'), [
            'nodes' => $this->number(Node::count()),
            'edges' => $this->number(Edge::count()),
            'activations' => $this->number(Activation::count()),
            'skills' => $this->number((int) ($byType['skill'] ?? 0)),
            'memories' => $this->number((int) ($byType['memory'] ?? 0)),
            'projects' => $this->number((int) ($byType['project'] ?? 0)),
            'areas' => $this->number(Area::count()),
            'departments' => $this->number(Department::count()),
            'recent' => $this->number(Node::where('created_at', '>=', now()->subDays(7))->count()),
        ]);

        return new ChatAnswer(text: $text, intent: $intent);
    }

    /** memory.decisions — posledné rozhodnutia zo Smernice. */
    private function decisions(Intent $intent): ChatAnswer
    {
        $total = Decision::count();

        if ($total === 0) {
            return new ChatAnswer(text: $this->template('memory.decisions', 'miss'), intent: $intent);
        }

        $decisions = Decision::query()
            ->with('node')
            ->orderByDesc('decided_on')
            ->orderByDesc('id')
            ->limit(5)
            ->get();

        $list = $decisions->map(function (Decision $d): string {
            $when = $d->decided_on?->format('d.m.Y');
            $line = '- '.trim((string) $d->text);
            if ($when) {
                $line .= ' _('.$when.')_';
            }
            if (trim((string) $d->reason) !== '') {
                $line .= "\n  Dôvod: ".trim((string) $d->reason);
            }

            return $line;
        })->implode("\n");

        $text = $this->fill($this->template('memory.decisions', 'hit'), [
            'total' => $this->number($total),
            'list' => $list,
        ]);

        return new ChatAnswer(
            text: $text,
            intent: $intent,
            citations: $decisions->pluck('node_id')->filter()->map('intval')->unique()->values()->all(),
        );
    }

    /** memory.recent_work — uzly podľa poslednej aktivácie. */
    private function recentWork(Intent $intent): ChatAnswer
    {
        $nodes = Node::query()
            ->with(['area', 'department'])
            ->whereNotNull('last_activated_at')
            ->where('last_activated_at', '>=', now()->subDays(self::RECENT_DAYS))
            ->orderByDesc('last_activated_at')
            ->limit(self::LIST_LIMIT)
            ->get();

        if ($nodes->isEmpty()) {
            return new ChatAnswer(
                text: $this->fill($this->template('memory.recent_work', 'miss'), ['days' => (string) self::RECENT_DAYS]),
                intent: $intent,
            );
        }

        $text = $this->fill($this->template('memory.recent_work', 'hit'), [
            'count' => $this->number($nodes->count()),
            'count_word' => $this->plural($nodes->count(), 'uzol', 'uzly', 'uzlov'),
            'last' => $nodes->first()?->last_activated_at?->format('d.m.Y H:i') ?? '—',
            'list' => $this->renderList($nodes),
        ]);

        return new ChatAnswer(text: $text, intent: $intent, citations: $this->ids($nodes));
    }

    /** memory.skills_in_area — skilly v jednej z 5 fixných oblastí. */
    private function skillsInArea(Intent $intent, string $message): ChatAnswer
    {
        $area = $this->matchArea($intent->param('area') ?? $message);

        if (! $area instanceof Area) {
            // Bez rozpoznanej oblasti odpovieme prehľadom skillov po oblastiach —
            // tichý fallback do prvej oblasti by bol presne bug z W0-NALEZY §1.
            return $this->skillsOverview($intent);
        }

        $nodes = Node::query()
            ->with(['area', 'department'])
            ->where('area_id', $area->id)
            ->where('type', 'skill')
            ->orderByDesc('strength')
            ->limit(self::LIST_LIMIT)
            ->get();

        $total = Node::where('area_id', $area->id)->where('type', 'skill')->count();

        if ($total === 0) {
            return new ChatAnswer(
                text: $this->fill($this->template('memory.skills_in_area', 'miss'), ['area' => $area->name]),
                intent: $intent,
            );
        }

        $text = $this->fill($this->template('memory.skills_in_area', 'hit'), [
            'area' => $area->name,
            'count' => $this->number($total),
            'count_word' => $this->plural($total, 'skill', 'skilly', 'skillov'),
            'list' => $this->renderList($nodes),
        ]);

        return new ChatAnswer(text: $text, intent: $intent, citations: $this->ids($nodes));
    }

    /** Prehľad skillov po oblastiach — keď dopyt oblasť nepomenoval. */
    private function skillsOverview(Intent $intent): ChatAnswer
    {
        $counts = Node::query()
            ->selectRaw('area_id, COUNT(*) AS total')
            ->where('type', 'skill')
            ->groupBy('area_id')
            ->pluck('total', 'area_id');

        $lines = Area::orderBy('id')->get()->map(function (Area $a) use ($counts): string {
            $total = (int) ($counts[$a->id] ?? 0);

            return '- **'.$a->name.'** — '.$this->number($total).' '.$this->plural($total, 'skill', 'skilly', 'skillov');
        })->implode("\n");

        return new ChatAnswer(
            text: "Skilly mám rozdelené takto:\n\n".$lines."\n\nSpýtaj sa na konkrétnu oblasť a vymenujem ich.",
            intent: $intent,
        );
    }

    /** memory.project — jeden projekt + jeho okolie. */
    private function project(Intent $intent, string $message, ?string $sessionKey): ChatAnswer
    {
        $subject = $intent->param('subject');
        $node = $this->findProject($subject ?? $message);

        if (! $node instanceof Node) {
            // Bez presnej zhody skúsime recall — „projekt" mohol byť len kontext.
            $recalled = $this->recall->recall($subject ?? $message, 8, $sessionKey);
            $node = $recalled->firstWhere('type', 'project');

            if (! $node instanceof Node) {
                return new ChatAnswer(
                    text: $this->fill($this->template('memory.project', 'miss'), [
                        'subject' => $subject ?? trim($message),
                    ]),
                    intent: $intent,
                    citations: $this->ids($recalled->take(self::LIST_LIMIT)),
                );
            }
        }

        $related = $this->neighbours($node);
        $description = trim((string) $node->description);

        $text = $this->fill($this->template('memory.project', 'hit'), [
            'label' => $node->label,
            'area' => $node->area?->name ?? 'bez oblasti',
            'strength' => $this->number((int) round($node->strength)),
            'description' => $description !== '' ? $description."\n" : '',
            'related' => $related->isEmpty()
                ? ''
                : "\nSúvisí s tým:\n\n".$this->renderList($related),
        ]);

        return new ChatAnswer(
            text: $text,
            intent: $intent,
            citations: array_values(array_unique(array_merge([$node->id], $this->ids($related)))),
        );
    }

    /** memory.about — čo mám k téme. */
    private function about(Intent $intent, string $message, ?string $sessionKey): ChatAnswer
    {
        $subject = $intent->param('subject') ?? trim($message);
        $nodes = $this->recall->recall($subject, 10, $sessionKey);

        if ($nodes->isEmpty()) {
            return new ChatAnswer(
                text: $this->fill($this->template('memory.about', 'miss'), ['subject' => $subject]),
                intent: $intent,
            );
        }

        $shown = $nodes->take(self::LIST_LIMIT);

        $text = $this->fill($this->template('memory.about', 'hit'), [
            'subject' => $subject,
            'count' => $this->number($nodes->count()),
            'count_word' => $this->plural($nodes->count(), 'uzol', 'uzly', 'uzlov'),
            'list' => $this->renderList($shown),
        ]);

        return new ChatAnswer(text: $text, intent: $intent, citations: $this->ids($nodes));
    }

    /** Zámer 'none' — odpoveď z toho, čo recall aj tak našiel. */
    private function fromRecall(Intent $intent, string $message, ?string $sessionKey): ChatAnswer
    {
        $nodes = $this->recall->recall($message, 8, $sessionKey);

        if ($nodes->isEmpty()) {
            return new ChatAnswer(text: $this->template('none', 'miss'), intent: $intent);
        }

        $text = $this->fill($this->template('none', 'hit'), [
            'list' => $this->renderList($nodes->take(self::LIST_LIMIT)),
        ]);

        return new ChatAnswer(text: $text, intent: $intent, citations: $this->ids($nodes));
    }

    /** shop.* bez napojeného dátového zdroja (P11) — čestná odpoveď, žiadne vymyslené čísla. */
    private function shopUnavailable(Intent $intent): ChatAnswer
    {
        return new ChatAnswer(
            text: (string) config('prompts.templates.shop.unavailable', 'Tento zdroj dát ešte nie je napojený.'),
            intent: $intent,
            degraded: true,
            reason: 'shop_source_unavailable',
        );
    }

    /** Podklad pre eskalačnú vetvu — uzly, z ktorých má model čerpať. */
    public function recallFor(string $message, int $limit, ?string $sessionKey): Collection
    {
        return $this->recall->recall($message, $limit, $sessionKey);
    }

    /** @param  Collection<int, Node>  $nodes */
    private function renderList(Collection $nodes): string
    {
        return $nodes->map(function (Node $n): string {
            $meta = collect([$this->typeLabel($n->type), $n->area?->name, $n->department?->name])
                ->filter()
                ->implode(' · ');

            $line = '- **'.$n->label.'** — '.$meta;
            $description = trim((string) $n->description);
            if ($description !== '') {
                $line .= "\n  ".mb_strimwidth($description, 0, 220, '…');
            }

            return $line;
        })->implode("\n");
    }

    /** Priami susedia uzla (graph-walk hĺbky 1). @return Collection<int, Node> */
    private function neighbours(Node $node): Collection
    {
        $ids = Edge::query()
            ->where('source_id', $node->id)
            ->orWhere('target_id', $node->id)
            ->get(['source_id', 'target_id'])
            ->flatMap(fn (Edge $e) => [$e->source_id, $e->target_id])
            ->reject(fn ($id) => (int) $id === (int) $node->id)
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            return collect();
        }

        return Node::query()
            ->with(['area', 'department'])
            ->whereIn('id', $ids->all())
            ->orderByDesc('strength')
            ->limit(self::LIST_LIMIT)
            ->get();
    }

    private function findProject(string $subject): ?Node
    {
        $subject = trim($subject);
        if (mb_strlen($subject) < 2) {
            return null;
        }

        $folded = $this->normalizer->fold($subject);

        // Zhoda na zložený label — „šperky aura app" trafí aj „Šperky Aura app".
        $candidates = Node::query()->with(['area', 'department'])->where('type', 'project')->get();

        foreach ($candidates as $node) {
            $label = $this->normalizer->fold((string) $node->label);
            if ($label !== '' && ($label === $folded || str_contains($folded, $label))) {
                return $node;
            }
        }

        return null;
    }

    private function matchArea(string $needle): ?Area
    {
        $folded = $this->normalizer->fold($needle);
        if ($folded === '') {
            return null;
        }

        foreach (Area::orderBy('id')->get() as $area) {
            $name = $this->normalizer->fold((string) $area->name);
            $slug = $this->normalizer->fold((string) $area->slug);

            // Prvé slovo názvu oblasti („marketing", „vyvoj", „dizajn", „biznis", „osobne")
            $head = explode(' ', $name)[0] ?? '';

            if (($head !== '' && str_contains($folded, $head))
                || ($slug !== '' && str_contains($folded, $slug))) {
                return $area;
            }
        }

        return null;
    }

    private function typeLabel(string $type): string
    {
        return match ($type) {
            'skill' => 'skill',
            'memory' => 'spomienka',
            'project' => 'projekt',
            'core' => 'jadro',
            default => $type,
        };
    }

    /**
     * Kľúče šablón obsahujú bodku („memory.about"), takže sa NESMIE použiť
     * `config('prompts.templates.memory.about.hit')` — tečková notácia by ju
     * čítala ako zanorenie a vrátila null. Preto sa berie celé pole.
     */
    private function template(string $intent, string $variant): string
    {
        $templates = (array) config('prompts.templates', []);
        $group = $templates[$intent] ?? null;
        $text = is_array($group) ? ($group[$variant] ?? null) : null;

        return is_string($text) && $text !== '' ? $text : 'Na toto v pamäti nič nemám.';
    }

    /** @param  array<string, string>  $values */
    private function fill(string $template, array $values): string
    {
        $replace = [];
        foreach ($values as $key => $value) {
            $replace[':'.$key] = $value;
        }

        // Najdlhšie kľúče prvé, aby `:count_word` neprepísal `:count`.
        uksort($replace, fn (string $a, string $b) => mb_strlen($b) <=> mb_strlen($a));

        return trim(strtr($template, $replace));
    }

    /**
     * @param  Collection<int, Node>  $nodes
     * @return list<int>
     */
    private function ids(Collection $nodes): array
    {
        return $nodes->pluck('id')->map('intval')->unique()->values()->all();
    }

    /** Nezlomiteľná medzera v tisícoch by rozbila validáciu čísel pri preformulovaní. */
    private function number(int $value): string
    {
        return number_format($value, 0, ',', ' ');
    }

    private function plural(int $count, string $one, string $few, string $many): string
    {
        return match (true) {
            $count === 1 => $one,
            $count >= 2 && $count <= 4 => $few,
            default => $many,
        };
    }
}
