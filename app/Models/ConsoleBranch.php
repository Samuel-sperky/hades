<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

/**
 * Vetva konverzácie. Dva ukazovatele nesú celé vetvenie:
 *
 *  - `parent_branch_id` — z ktorej vetvy vyrastá (`null` = korenná vetva vlákna),
 *  - `forked_from_message_id` — POSLEDNÁ správa rodičovskej vetvy, ktorú si táto
 *    vetva dedí.
 *
 * **Žiadna existujúca správa sa neprepisuje ani nemaže.** Editácia vlastnej
 * správy založí novú vetvu, ktorá dedí prefix po `forked_from_message_id`, a
 * upravená správa je jej prvý vlastný záznam ({@see forkBefore()}). Pôvodná vetva
 * je čitateľná ďalej.
 *
 * ## `forked_from_message_id = 0` nie je `null`
 *
 * `null` je vyhradené korennej vetve a v skládaní histórie znamená „bez stropu",
 * teda „dedí všetko". Keď človek edituje PRVÚ správu vlákna, nová vetva nededí
 * nič — a to je `0`, nie `null`: `id <= 0` je prázdna množina, kým `null` by
 * vetve podstrčilo celú pôvodnú konverzáciu. Je to sentinel, nie chýbajúca
 * hodnota, a {@see ConsoleThread::branchChain()} ho číta z oboch strán.
 */
class ConsoleBranch extends Model
{
    use HasFactory;

    protected $fillable = ['uuid', 'thread_id', 'parent_branch_id', 'forked_from_message_id'];

    protected $casts = [
        'thread_id' => 'int',
        'parent_branch_id' => 'int',
        'forked_from_message_id' => 'int',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $branch) {
            $branch->uuid ??= (string) Str::uuid();
        });
    }

    public function thread(): BelongsTo
    {
        return $this->belongsTo(ConsoleThread::class, 'thread_id');
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_branch_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(self::class, 'parent_branch_id');
    }

    /**
     * Vlastné správy vetvy — teda BEZ dedeného prefixu. Na históriu, ktorú vidí
     * model alebo človek, je {@see ConsoleThread::branchMessages()}.
     */
    public function ownMessages(): HasMany
    {
        return $this->hasMany(ConsoleMessage::class, 'branch_id');
    }

    public function isRoot(): bool
    {
        return $this->parent_branch_id === null;
    }

    /**
     * Korenná vetva vlákna — a keď žiadna nie je, založí ju.
     *
     * Vlákno bez vetvy je stav, ktorý vznikne pri každom novom vlákne (migrácia
     * backfillovala len tie existujúce). Zakladá sa preto lenivo, pri prvom
     * dotyku, a nie v `ConsoleThread::booted()`: vetva je záznam o konverzácii,
     * ktorá sa ešte nemusí začať.
     */
    public static function rootFor(ConsoleThread $thread): self
    {
        $root = static::query()
            ->where('thread_id', $thread->id)
            ->whereNull('parent_branch_id')
            ->orderBy('id')
            ->first();

        if ($root !== null) {
            return $root;
        }

        $root = static::create([
            'thread_id' => $thread->id,
            'parent_branch_id' => null,
            'forked_from_message_id' => null,
        ]);

        // Vlákno bez aktívnej vetvy dostane túto; vlákno, ktoré už niekam
        // ukazuje, sa neprepisuje — visiaci ukazovateľ opravuje
        // `ConsoleThread::currentBranch()`, a to bez zápisu.
        if ($thread->active_branch_id === null) {
            $thread->active_branch_id = $root->id;
            $thread->save();
        }

        return $root;
    }

    /**
     * Nová vetva, ktorá dedí všetko PRED danou správou. Sama správa v novej vetve
     * nie je — jej upravenú podobu zapíše bežný beh (`/api/console/run`), takže
     * druhá cesta k modelu nevzniká a vetvenie sa nemusí starať o obsah.
     *
     * Strop sa hľadá **v reťazi vetvy, do ktorej správa patrí**, nie v celom
     * vlákne: `id` je globálny autoincrement, takže „predchádzajúca správa" podľa
     * `id` môže patriť do opustenej vetvy. Keď pred správou nič nie je, strop je
     * `0` (nededí nič) — viď docblock triedy.
     */
    public static function forkBefore(ConsoleMessage $message): self
    {
        $thread = $message->thread;
        $parent = $message->branch ?? static::rootFor($thread);

        $inherited = $thread->branchMessages($parent)
            ->where('id', '<', $message->id)
            ->max('id');

        return static::create([
            'thread_id' => $thread->id,
            'parent_branch_id' => $parent->id,
            'forked_from_message_id' => (int) ($inherited ?? 0),
        ]);
    }
}
