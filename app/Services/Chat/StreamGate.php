<?php

namespace App\Services\Chat;

use Illuminate\Contracts\Cache\Lock;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * Strážca počtu súbežných streamov (rozhodnutie #126). Vlastník P5.
 *
 * PREČO EXISTUJE: appka beží na `php artisan serve` s 8 workermi a SSE spojenie
 * obsadí jedného workera na celú dobu generovania. Osem paralelných streamov by
 * server zablokovalo. Gate drží najviac `llm.max_concurrent_streams` slotov
 * (default 1), takže streamy nikdy nezožerú viac než jeden worker.
 *
 * Keď je slot obsadený, požiadavka NEDOSTANE chybu — klient dostane
 * `meta {queued:true}` a po vypršaní čakania sa odpoveď doručí nestreamovane.
 */
final class StreamGate
{
    /** Slot sa uvolní najneskôr po tomto čase, aj keď proces spadne. */
    private const LOCK_TTL = 320;

    private ?Lock $lock = null;

    /** Skús obsadiť slot okamžite. */
    public function tryAcquire(): bool
    {
        $slots = max(1, (int) config('llm.max_concurrent_streams', 1));

        for ($i = 0; $i < $slots; $i++) {
            try {
                $lock = Cache::lock('llm.stream.slot.'.$i, self::LOCK_TTL);
                if ($lock->get()) {
                    $this->lock = $lock;

                    return true;
                }
            } catch (Throwable) {
                // Nedostupná cache nesmie zablokovať chat — v tom prípade
                // pustíme stream ďalej (degradácia na dnešné chovanie).
                return true;
            }
        }

        return false;
    }

    /** Čakaj na slot najviac `llm.stream_queue_wait` ms. */
    public function waitForSlot(): bool
    {
        $deadline = microtime(true) + (int) config('llm.stream_queue_wait', 8_000) / 1000;

        while (microtime(true) < $deadline) {
            if ($this->tryAcquire()) {
                return true;
            }
            usleep(200_000);
        }

        return false;
    }

    public function release(): void
    {
        try {
            $this->lock?->release();
        } catch (Throwable) {
            // Uvolnenie zámku nikdy nesmie vyhodiť výnimku do odpovede.
        }

        $this->lock = null;
    }
}
