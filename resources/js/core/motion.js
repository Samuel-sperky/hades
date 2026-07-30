/* Single source of truth for the reduced-motion preference. Read at load time,
   exactly as the monolith did. */

export const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
