/* Race guard for overlapping async responses: take a ticket before the request,
   drop the response if a newer ticket was issued meanwhile. Replaces the ad-hoc
   reloadSeq / searchSeq / cmdkSeq / directiveBuildSeq counters. */

export function counter() {
    let n = 0;
    return {
        next: () => ++n,
        current: () => n,
        /** true when `ticket` is still the newest one issued. */
        isCurrent: (ticket) => ticket === n,
    };
}
