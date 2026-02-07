/** Intentional no-op for Chrome messaging .catch() — receiver may not exist (e.g., no active tab, panel closed) */
export const NOOP = () => {};

/** Brand accent color — single source for content scripts.
 *  SYNC: worker.ts keeps its own copy (separate MV3 execution context).
 *  SYNC: index.html defines this as --ds-orange in the design system. */
export const BRAND_ORANGE = '#EE6019';
