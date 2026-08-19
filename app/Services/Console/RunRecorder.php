<?php

namespace App\Services\Console;

use App\Models\ConsoleMessage;
use App\Models\ConsoleThread;
use App\Models\Run;

/**
 * Zapisovateľ behov — jediné miesto, kde vzniká riadok v `runs`.
 *
 * **Nič v `AgentRunner`i nemení a ani nemôže.** Recorder sa vešia na `$emit`,
 * teda na rámec protokolu, ktorý beh už dnes posiela klientovi
 * ({@see RunRecorder::wrap()}). Dôvod nie je elegancia, ale kolízia: `AgentRunner`
 * paralelne prepisuje druhá session (§0 kontraktu), takže jediná bezpečná
 * integrácia je tá, ktorá sa jeho súboru nedotkne. Vedľajší efekt je, že recorder
 * je testovateľný bez modelu — stačí mu poslať rámce.
 *
 * **Beh môže byť rozdelený na segmenty.** Dvojfázová brána znamená, že `/run`
 * skončí rámcom `permission` bez `end`, a `/decide` ten istý ťah dokončí. Beh
 * preto zostáva v stave `waiting` a ďalší segment ho **znovu otvorí**
 * ({@see RunRecorder::resume()}), nezaloží nový.
 *
 * **Zápisov do DB je málo, nie na rámec.** `delta` chodí pri ~9 tok/s desiatky
 * ráz za sekundu a nenesie nič, čo by log potreboval, takže sa ticho ignoruje.
 * Ukladá sa na rámcoch, ktoré menia stav: `step`, `tool`, `permission`, `end`,
 * `error`.
 */
class RunRecorder
{
    /** Rámce, ktoré nesú stav behu. Všetko ostatné (`delta`, `start`, `tool_result`) sa neukládá. */
    private const STATEFUL = ['step', 'tool', 'permission', 'end', 'error'];

    /**
     * Nový beh. `from_message_id` je dolná hranica rozsahu: správa, ktorú
     * `AgentRunner` o chvíľu založí, dostane id vyššie než čokoľvek existujúce.
     * Spolu s filtrom na `thread_id` je rozsah presný, nie približný.
     */
    public function open(ConsoleThread $thread, string $prompt, array $options = [], string $source = 'console'): Run
    {
        return Run::create([
            'thread_id' => $thread->id,
            'source' => $source,
            'prompt' => $prompt,
            'provider' => $options['provider'] ?? $thread->provider,
            'model' => $options['model'] ?? $thread->model,
            'status' => 'running',
            'from_message_id' => (int) (ConsoleMessage::max('id') ?? 0) + 1,
            'started_at' => now(),
        ]);
    }

    /**
     * Pokračovanie zaparkovaného behu po rozhodnutí človeka.
     *
     * Ak sa otvorený beh nenájde (appka sa medzitým reštartovala, alebo bol
     * záznam zmazaný), vráti sa nový — inak by rozhodnutie o zápise nebolo
     * v logu vôbec, a to je práve ten záznam, na ktorom v logu behov záleží.
     */
    public function resume(ConsoleThread $thread, string $prompt = '', array $options = []): Run
    {
        $run = Run::query()
            ->where('thread_id', $thread->id)
            ->open()
            ->orderByDesc('id')
            ->first();

        if ($run === null) {
            return $this->open($thread, $prompt, $options);
        }

        $run->status = 'running';
        $run->save();

        return $run;
    }

    /**
     * Obal nad `$emit`, ktorý rámce najprv zaznamená a potom pošle ďalej.
     *
     * Poradie je zámerné: keby sa najprv posielalo a potom zapisovalo, pri odchode
     * klienta uprostred rámca (`ignore_user_abort`) by sa stav behu nezapísal.
     *
     * @param  callable(array<string, mixed>): void  $emit
     * @return callable(array<string, mixed>): void
     */
    public function wrap(Run $run, callable $emit): callable
    {
        return function (array $frame) use ($run, $emit): void {
            $this->observe($run, $frame);
            $emit($frame);
        };
    }

    /** Jeden rámec protokolu → stav behu. */
    public function observe(Run $run, array $frame): void
    {
        $type = $frame['t'] ?? '';

        if (! in_array($type, self::STATEFUL, true)) {
            return;
        }

        match ($type) {
            'step' => $run->steps++,
            'tool' => $run->tool_calls++,
            'permission' => $run->status = 'waiting',
            'error' => $this->fail($run, (string) ($frame['message'] ?? '')),
            'end' => $this->finish($run, $frame),
            default => null,
        };


        $run->save();
    }

    /**
     * Uzavretie segmentu. `$aborted` hovorí, že klient odišiel — beh potom nie je
     * `done` ani `failed`, ale `aborted`, a to je rozdiel, ktorý má byť v logu
     * vidieť (model ďalej generoval do mŕtveho socketu, kým to smyčka zbadala).
     */
    public function close(Run $run, bool $aborted = false): void
    {
        $last = (int) (ConsoleMessage::query()
            ->where('thread_id', $run->thread_id)
            ->max('id') ?? 0);

        if ($last >= (int) $run->from_message_id) {
            $run->to_message_id = $last;
        }

        $this->aggregate($run);

        // Zaparkovaný beh sa nezatvára: čaká na `/decide` a jeho trvanie by inak
        // meralo, ako dlho sa človek rozhodoval.
        if ($run->status !== 'waiting') {
            if ($run->status === 'running') {
                $run->status = $aborted ? 'aborted' : 'done';
            }

            $run->ended_at = now();
            $run->duration_ms = $run->started_at !== null
                ? (int) $run->started_at->diffInMilliseconds($run->ended_at)
                : null;
        }

        $run->save();
    }

    private function fail(Run $run, string $message): void
    {
        $run->status = 'failed';
        $run->error = $message !== '' ? $message : 'Beh spadol bez správy.';
    }

    /**
     * Rámec `end` nesie len dôvod ukončenia. Tokeny sa z neho **neberú**: ťah,
     * ktorý zaparkoval na potvrdení zápisu, `end` vôbec nepošle, takže by cena
     * jeho prvého segmentu z logu vypadla. Sčítava ich {@see self::aggregate()}
     * z `console_messages`, kde sú tak či tak.
     */
    private function finish(Run $run, array $frame): void
    {
        $run->stop_reason = (string) ($frame['stop_reason'] ?? '') ?: $run->stop_reason;

        if ($run->status === 'running') {
            $run->status = 'done';
        }
    }

    /**
     * Cena behu spočítaná z jeho správ — jediný zdroj, žiadna tretia kópia.
     *
     * `console_messages.duration_ms` je **generovací** čas (`AgentRunner` doňho
     * ukládá `evalDurationMs`), nie wall clock. Preto z týchto súčtov vyjde
     * pravdivé tok/s aj pri behu, v ktorom sa človek dve minúty rozhodoval
     * o zápise — kým `runs.duration_ms` zámerne wall clock JE, lebo na otázku
     * „ako dlho som na to čakal" odpovedá práve on.
     */
    private function aggregate(Run $run): void
    {
        if ($run->from_message_id === null || $run->to_message_id === null) {
            return;
        }

        $totals = ConsoleMessage::query()
            ->where('thread_id', $run->thread_id)
            ->whereBetween('id', [$run->from_message_id, $run->to_message_id])
            ->selectRaw('SUM(tokens_in) as tin, SUM(tokens_out) as tout, SUM(duration_ms) as gen')
            ->first();

        $run->tokens_in = $totals?->tin !== null ? (int) $totals->tin : null;
        $run->tokens_out = $totals?->tout !== null ? (int) $totals->tout : null;

        $generatedMs = (int) ($totals?->gen ?? 0);

        $run->tokens_per_second = $generatedMs > 0 && (int) $run->tokens_out > 0
            ? round($run->tokens_out / ($generatedMs / 1000), 2)
            : null;
    }

    /**
     * Behy, ktoré zostali visieť v `running` — appka sa reštartovala uprostred
     * ťahu, alebo PHP worker spadol. Bez tohto by v logu naveky svietil beh, ktorý
     * nikto nedokončí, a zoznam by lhal o tom, čo sa práve deje.
     */
    public function reapStale(int $olderThanMinutes = 30): int
    {
        // `ended_at` sa dopĺňa hodnotou z PHP, nie `NOW()` v SQL: testy bežia nad
        // SQLite, ktorá `NOW()` nemá, a beh, ktorý sa nedá otestovať, je beh, ktorý
        // sa raz ticho pokazí.
        return Run::query()
            ->where('status', 'running')
            ->where('started_at', '<', now()->subMinutes($olderThanMinutes))
            ->update([
                'status' => 'aborted',
                'ended_at' => now(),
                'updated_at' => now(),
            ]);
    }
}
