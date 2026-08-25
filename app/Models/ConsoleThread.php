<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * Jedno vlákno konzoly. `uuid` je verejný identifikátor v URL, `id` zostáva
 * vnútri — počet vlákien nie je informácia, ktorú má adresný riadok prezrádzať.
 *
 * Od 25. 8. 2026 je vlákno **vetvené**: správy patria vetve
 * (`console_messages.branch_id`) a aktívna vetva je `active_branch_id`. História,
 * ktorú vidí model aj človek, sa skladá {@see branchMessages()} — jedným
 * `SELECT`om nad reťazou vetvy, bez rekurzie a bez CTE.
 *
 * **Exkluzivita behu zostáva na úrovni VLÁKNA, nie vetvy.** `RunRecorder`
 * zamyká riadok vlákna a `RunController::run` odmietne správu, kým čaká
 * nedorozhodnutý zápis. Vetvy žijú vnútri jedného vlákna, takže prepnutie vetvy
 * nevyrába druhého pisateľa — a keby ho vyrobilo, každý rozsah
 * `from_message_id`–`to_message_id` v tom vlákne sa stane nepresným.
 */
class ConsoleThread extends Model
{
    use HasFactory;

    protected $fillable = [
        'uuid', 'project_id', 'active_branch_id', 'parent_thread_id', 'title', 'provider', 'model',
        'tool_profile', 'max_steps', 'auto_accept', 'last_message_at', 'pinned_at', 'archived_at',
    ];

    protected $casts = [
        'auto_accept' => 'bool',
        'last_message_at' => 'datetime',
        'pinned_at' => 'datetime',
        'archived_at' => 'datetime',
        'project_id' => 'int',
        'active_branch_id' => 'int',
        'parent_thread_id' => 'int',
        'max_steps' => 'int',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $thread) {
            $thread->uuid ??= (string) Str::uuid();
        });
    }

    public function messages(): HasMany
    {
        return $this->hasMany(ConsoleMessage::class, 'thread_id');
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(ConsoleProject::class, 'project_id');
    }

    public function branches(): HasMany
    {
        return $this->hasMany(ConsoleBranch::class, 'thread_id');
    }

    /**
     * Vlákno podagenta (`spawn_agent`) — **nie je to konverzácia.**
     *
     * Dôsledky, ktoré z toho plynú a ktoré držia dvojfázovú bránu tesnou:
     * `RunController::run` doňho odmietne správu (rámec `agent_wait` posiela jeho
     * uuid do prehliadača, takže klient ho pozná a bez guardu by doň vedel písať),
     * a zoznam vlákien ho nesmie ukázať ({@see self::scopeConversations()}). Cesta,
     * ktorá povolená ZOSTÁVA, je `POST /api/console/decide` — to je celá brána.
     */
    public function isSubagent(): bool
    {
        return $this->parent_thread_id !== null;
    }

    /**
     * Vlákna, ktoré sú konverzáciou človeka — teda bez vlákien podagentov.
     *
     * Scope a nie `where` v kontroléri: filtruje ho zoznam v bočnom paneli aj
     * hľadanie a dve kópie tej istej podmienky sa rozídu presne vtedy, keď jednu
     * z nich niekto zmení. Detail podbehu sa otvára z obrazovky Runy (`runs.uuid`),
     * kam patrí.
     *
     * @param  Builder<self>  $query
     * @return Builder<self>
     */
    public function scopeConversations(Builder $query): Builder
    {
        return $query->whereNull('parent_thread_id');
    }

    /**
     * Aktívna vetva vlákna, alebo `null` pri vlákne, ktoré ešte žiadnu nemá.
     *
     * `active_branch_id` je BEZ cudzieho kľúča (kruh `threads` ↔ `branches`),
     * takže tu sa overuje to, čo FK vyjadriť nevie: **ukazuje na vetvu TOHOTO
     * vlákna?** Keď nie — visiaci ukazovateľ po zmazaní vetvy alebo id z cudzieho
     * vlákna — čítanie spadne na korennú vetvu. Je to definovaný stav, nie chyba,
     * a **neopravuje sa zápisom**: čítanie histórie nemá byť operácia, ktorá mení
     * databázu.
     *
     * @param  Collection<int, ConsoleBranch>|null  $loaded  už načítané vetvy (šetrí dopyt v reťazi)
     */
    public function currentBranch(?Collection $loaded = null): ?ConsoleBranch
    {
        $branches = $loaded ?? $this->branches()->orderBy('id')->get()->keyBy('id');

        if ($branches->isEmpty()) {
            return null;
        }

        $active = $this->active_branch_id === null ? null : $branches->get($this->active_branch_id);

        return $active ?? $branches->first(fn (ConsoleBranch $b) => $b->isRoot()) ?? $branches->first();
    }

    /** Vetva, do ktorej má práve teraz padnúť nová správa. */
    public function currentBranchId(): ?int
    {
        return $this->currentBranch()?->id;
    }

    /**
     * Reťaz vetvy od danej (default: aktívnej) po korennú, so **stropom** pre
     * každý článok: `['branch_id' => int, 'ceiling' => ?int]`.
     *
     * Strop článku je `forked_from_message_id` jeho **dieťaťa** — teda posledná
     * správa, ktorú dieťa dedí. Vetva, od ktorej sa vychádza, strop nemá
     * (`null` = bez hornej hranice).
     *
     * Vetiev na vlákno sú jednotky, takže je to **jeden `SELECT`** nad
     * `console_branches` a prechod pamäťou. Poškodený strom (cyklus v
     * `parent_branch_id`, ktorý by v DB nemal vzniknúť) sa zastaví na už videnej
     * vetve — nekonečná smyčka by zabila jedného z ôsmich PHP workerov.
     *
     * @return list<array{branch_id: int, ceiling: int|null}>
     */
    public function branchChain(?ConsoleBranch $from = null): array
    {
        $branches = $this->branches()->orderBy('id')->get()->keyBy('id');
        $current = $from ?? $this->currentBranch($branches);

        if ($current === null) {
            return [];
        }

        $chain = [];
        $seen = [];
        $ceiling = null;

        while ($current !== null && ! isset($seen[$current->id])) {
            $seen[$current->id] = true;
            $chain[] = ['branch_id' => (int) $current->id, 'ceiling' => $ceiling];

            $parent = $current->parent_branch_id === null
                ? null
                : $branches->get($current->parent_branch_id);

            // Strop RODIČA je posledná správa, ktorú si toto dieťa dedí.
            // `null` na nekorennej vetve znamená „nededí nič" (viď docblock
            // ConsoleBranch) — preto 0, nie null: `null` by rodičovi zrušil
            // hornú hranicu a podstrčil vetve celú pôvodnú konverzáciu.
            $ceiling = $parent === null ? null : (int) ($current->forked_from_message_id ?? 0);
            $current = $parent;
        }

        return $chain;
    }

    /**
     * História jednej vetvy — **jeden dopyt, bez rekurzie a bez CTE**:
     *
     *     SELECT * FROM console_messages
     *      WHERE thread_id = :thread
     *        AND (   branch_id = 3                              -- aktívna, bez stropu
     *             OR (branch_id = 2 AND id <= 820)              -- dedený prefix
     *             OR ((branch_id = 1 OR branch_id IS NULL) AND id <= 500) )
     *
     * Dolná hranica v podmienkach chýbať MÔŽE: vetva vznikla po svojom odbočení,
     * takže všetky jej vlastné správy majú `id` väčšie než jej strop.
     *
     * `branch_id IS NULL` v korennom článku je **záchranná sieť, nie cesta
     * dopytu**: migrácia doplnila `branch_id` všetkým existujúcim správam, takže
     * NULLov je nula. Keby ich niekto vyrobil (zápis, ktorý zabudol vetvu),
     * správa sa objaví v korennej vetve — teda v pôvodnom lineárnom chovaní. Je
     * to horší z dvoch stavov, ale VIDITEĽNÝ; neviditeľná správa by bola horšia.
     *
     * **Radenie tu zámerne nie je.** `ORDER BY id` je správne konverzačné
     * poradie aj naprieč vetvami (`id` je poradie vzniku a dedený prefix je vždy
     * starší než vlastné správy vetvy), ale okno histórie ho potrebuje opačne
     * (`orderByDesc('id')->limit($window)`). Keby radenie sedelo tu, dostal by
     * dopyt `ORDER BY id ASC, id DESC` a okno by tichom bralo NAJSTARŠIE správy.
     * Radí si preto volajúci.
     *
     * Vlákno bez vetiev vracia celú svoju históriu — to je stav pred vetvením
     * a lineárne chovanie je pre neho správne.
     *
     * @return Builder<ConsoleMessage>
     */
    public function branchMessages(?ConsoleBranch $from = null): Builder
    {
        $chain = $this->branchChain($from);
        $query = ConsoleMessage::query()->where('thread_id', $this->id);

        if ($chain === []) {
            return $query;
        }

        $rootId = $chain[count($chain) - 1]['branch_id'];

        return $query->where(function (Builder $outer) use ($chain, $rootId): void {
            foreach ($chain as $link) {
                $outer->orWhere(function (Builder $q) use ($link, $rootId): void {
                    if ($link['branch_id'] === $rootId) {
                        $q->where(function (Builder $b) use ($link): void {
                            $b->where('branch_id', $link['branch_id'])->orWhereNull('branch_id');
                        });
                    } else {
                        $q->where('branch_id', $link['branch_id']);
                    }

                    if ($link['ceiling'] !== null) {
                        $q->where('id', '<=', $link['ceiling']);
                    }
                });
            }
        });
    }

    public function toolCalls(): HasMany
    {
        return $this->hasMany(ConsoleToolCall::class, 'thread_id');
    }

    /** Tool call, ktorý drží beh a čaká na rozhodnutie človeka (dvojfázový model). */
    public function pendingToolCall(): ?ConsoleToolCall
    {
        return $this->toolCalls()->where('status', 'pending')->orderBy('id')->first();
    }

    /**
     * Titulok vlákna z prvej vety používateľa — konzola ho nikdy nevymýšľa
     * modelom. Na CPU inferencii by to bola sekunda čakania za kozmetiku.
     */
    public function titleFrom(string $firstMessage): string
    {
        $clean = trim(preg_replace('/\s+/u', ' ', $firstMessage) ?? '');

        return Str::limit($clean === '' ? 'Nové vlákno' : $clean, 60);
    }
}
