import { now } from '../core/format.js';
import { S } from '../core/state/index.js';


export function markAwake() {
    S.awakeUntil = now() + S.awakeMinutes * 60000;
}


export function isAwake() {
    return now() < S.awakeUntil;
}
