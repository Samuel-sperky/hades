<?php

namespace Tests\Feature;

use App\Http\Controllers\Console\ThreadController;
use App\Models\ConsoleThread;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Zoznam vlákien konzoly — príznaky pripnutia a archivácie, priznaný celkový
 * počet a stránkovanie.
 *
 * Sada pinuje tri veci, ktoré sa dajú „opraviť" na horšie:
 *
 *  1. **`counts.total` je nad TÝM ISTÝM rozsahom, aký zoznam vracia.** Vlákna
 *     podagentov sa nepočítajú (zoznam ich nevypisuje), archivované áno (zoznam
 *     ich vypisuje). Kto to rozviaže, urobí z „N z M" na ploche lož.
 *  2. **Pripnutie musí vlákno posunúť.** Keby radenie ostalo len podľa času,
 *     bolo by pripnutie tichým no-opom — a to je presne tá porucha, ktorú
 *     `public/js/chat/threads.js` v komentári menuje ako horšiu než chýbajúca
 *     funkcia.
 *  3. **`PATCH {pinned:true}` píše timestamp, nie boolean** a opakovanie ho
 *     neprepisuje. Bez toho by poradie pripnutých bolo poradie posledného kliku.
 *
 * Vlákna sa zakládajú s explicitným `last_message_at`, pretože radenie stojí
 * na ňom: pri `null` by o poradí rozhodlo, ako daná DB radí NULL v `DESC`, a
 * test by meral engine, nie kód.
 */
class ConsoleThreadListTest extends TestCase
{
    use RefreshDatabase;

    /** Vlákno so zadaným časom poslednej správy. */
    private function thread(string $title, string $at, array $extra = []): ConsoleThread
    {
        return ConsoleThread::create(array_merge([
            'title' => $title,
            'last_message_at' => $at,
        ], $extra));
    }

    public function test_the_list_carries_pin_and_archive_flags(): void
    {
        $this->thread('Nové', '2026-09-02 10:00:00');
        $this->thread('Pripnuté', '2026-09-01 10:00:00', ['pinned_at' => '2026-09-01 12:00:00']);
        $this->thread('V archíve', '2026-08-30 10:00:00', ['archived_at' => '2026-08-31 12:00:00']);

        $rows = $this->getJson('/api/console/threads')
            ->assertOk()
            ->assertJsonPath('threads.0.pinned', true)
            ->assertJsonPath('threads.0.archived', false)
            ->json('threads');

        $flags = collect($rows)->mapWithKeys(fn ($r) => [$r['title'] => [$r['pinned'], $r['archived']]]);

        $this->assertSame([false, false], $flags['Nové']);
        $this->assertSame([true, false], $flags['Pripnuté']);
        // Archivované vlákno zo zoznamu NEVYPADNE — `/chat` si z neho kreslí
        // vlastnú sekciu Archív a bez riadku by tá sekcia bola vždy prázdna.
        $this->assertSame([false, true], $flags['V archíve']);
    }

    public function test_pinned_threads_come_first_even_when_they_are_the_oldest(): void
    {
        $this->thread('Najnovšie', '2026-09-02 10:00:00');
        $this->thread('Stredné', '2026-09-01 10:00:00');
        $this->thread('Staré a pripnuté', '2026-01-01 10:00:00', ['pinned_at' => '2026-09-02 09:00:00']);

        $titles = collect($this->getJson('/api/console/threads')->json('threads'))
            ->pluck('title')
            ->all();

        $this->assertSame(['Staré a pripnuté', 'Najnovšie', 'Stredné'], $titles);
    }

    public function test_total_counts_conversations_including_archived_but_not_subagents(): void
    {
        $parent = $this->thread('Konverzácia', '2026-09-02 10:00:00');
        $this->thread('V archíve', '2026-09-01 10:00:00', ['archived_at' => '2026-09-01 11:00:00']);
        $this->thread('Podagent', '2026-09-02 11:00:00', ['parent_thread_id' => $parent->id]);

        $body = $this->getJson('/api/console/threads')->assertOk()->json();

        // Rovnosť medzi počtom riadkov a `total` je celý zmysel toho poľa:
        // vlákien je v tabuľke 3, konverzácií 2 a zoznam vracia práve tie 2.
        $this->assertSame(3, ConsoleThread::count());
        $this->assertCount(2, $body['threads']);
        $this->assertSame(2, $body['counts']['total']);
    }

    public function test_offset_shifts_the_window_and_keeps_the_total(): void
    {
        $this->thread('A', '2026-09-03 10:00:00');
        $this->thread('B', '2026-09-02 10:00:00');
        $this->thread('C', '2026-09-01 10:00:00');

        $first = $this->getJson('/api/console/threads')->assertOk()->json();
        $shifted = $this->getJson('/api/console/threads?offset=1')->assertOk()->json();

        $this->assertSame(['A', 'B', 'C'], collect($first['threads'])->pluck('title')->all());
        $this->assertSame(['B', 'C'], collect($shifted['threads'])->pluck('title')->all());
        // Celok je celok — posun okna ho nemení, inak by „N z M" pri dotiahnutí
        // ďalšej strany klesalo.
        $this->assertSame(3, $shifted['counts']['total']);
    }

    public function test_a_broken_offset_is_refused_not_sanitized(): void
    {
        $this->thread('A', '2026-09-03 10:00:00');

        $this->getJson('/api/console/threads?offset=-1')->assertStatus(422);
        $this->getJson('/api/console/threads?offset=nie')->assertStatus(422);
        $this->getJson('/api/console/threads?offset=999999')->assertStatus(422);

        // Strop je súčasťou kontraktu s klientom (`THREAD_LIMIT` v
        // `public/js/console/main.js` ho zrkadlí), takže sa nesmie zmeniť ticho.
        $this->assertSame(100, ThreadController::PAGE);
    }

    public function test_pinning_writes_a_timestamp_and_repinning_keeps_the_first_one(): void
    {
        $thread = $this->thread('Vlákno', '2026-09-02 10:00:00');

        $this->patchJson("/api/console/threads/{$thread->uuid}", ['pinned' => true])
            ->assertOk()
            ->assertJsonPath('pinned', true);

        $this->assertNotNull(ConsoleThread::where('uuid', $thread->uuid)->value('pinned_at'));

        // Čas sa posunie do minulosti RUČNE, a nie je to kozmetika: dva `PATCH`e
        // v tej istej sekunde dajú rovnaký `now()`, takže porovnanie „pred a po"
        // prejde aj kódu, ktorý čas prepisuje — zmerané na mutantovi
        // `$data['pinned'] ? now() : null`, ktorý takto napísaný test NEROZBIL.
        ConsoleThread::where('uuid', $thread->uuid)->update(['pinned_at' => '2026-01-01 00:00:00']);

        $this->patchJson("/api/console/threads/{$thread->uuid}", ['pinned' => true])->assertOk();
        $this->assertSame(
            '2026-01-01 00:00:00',
            ConsoleThread::where('uuid', $thread->uuid)->value('pinned_at')->toDateTimeString(),
        );

        $this->patchJson("/api/console/threads/{$thread->uuid}", ['pinned' => false])
            ->assertOk()
            ->assertJsonPath('pinned', false);

        $this->assertNull(ConsoleThread::where('uuid', $thread->uuid)->value('archived_at'));
        $this->assertNull(ConsoleThread::where('uuid', $thread->uuid)->value('pinned_at'));
    }

    public function test_archiving_a_thread_is_a_timestamp_and_survives_a_round_trip(): void
    {
        $thread = $this->thread('Vlákno', '2026-09-02 10:00:00');

        $this->patchJson("/api/console/threads/{$thread->uuid}", ['archived' => true])
            ->assertOk()
            ->assertJsonPath('archived', true);

        $this->assertNotNull(ConsoleThread::where('uuid', $thread->uuid)->value('archived_at'));
        $this->getJson("/api/console/threads/{$thread->uuid}")->assertJsonPath('archived', true);

        $this->patchJson("/api/console/threads/{$thread->uuid}", ['archived' => false])
            ->assertOk()
            ->assertJsonPath('archived', false);

        $this->assertNull(ConsoleThread::where('uuid', $thread->uuid)->value('archived_at'));
    }

    public function test_a_broken_flag_is_refused(): void
    {
        $thread = $this->thread('Vlákno', '2026-09-02 10:00:00');

        $this->patchJson("/api/console/threads/{$thread->uuid}", ['pinned' => 'možno'])->assertStatus(422);
        $this->patchJson("/api/console/threads/{$thread->uuid}", ['archived' => 'možno'])->assertStatus(422);
        $this->assertNull(ConsoleThread::where('uuid', $thread->uuid)->value('pinned_at'));
    }
}
