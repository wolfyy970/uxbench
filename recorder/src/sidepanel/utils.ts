// Pure utility functions extracted from app.ts for testability.
// These have no DOM or Chrome API dependencies.

/** Format milliseconds as a human-readable task time (decimal seconds). */
export function formatTaskTime(ms: number): string {
    const totalSecs = ms / 1000;
    if (totalSecs < 60) return `${totalSecs.toFixed(2)}s`;
    const mins = Math.floor(totalSecs / 60);
    const rem = totalSecs - mins * 60;
    return `${mins}m ${rem.toFixed(2)}s`;
}

/** Format milliseconds as a duration string (integer seconds). */
export function formatDuration(ms: number): string {
    const secs = Math.floor(ms / 1000);
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    return mins > 0 ? `${mins}m ${remSecs}s` : `${remSecs}s`;
}

/** Round to 2 decimal places. */
export const round2 = (v: number) => Math.round(v * 100) / 100;

/** Format large numbers with 'k' suffix (e.g., 1500 → "1.5k"). */
export function formatCompact(n: number): string {
    if (n >= 1000) return round2(n / 1000) + 'k';
    return n.toString();
}

/** Read a value from an object using dot-notation path. Returns 0 if missing. */
export function getPath(obj: any, path: string): number {
    const parts = path.split('.');
    let cur = obj;
    for (const p of parts) {
        if (cur == null) return 0;
        cur = cur[p];
    }
    return typeof cur === 'number' ? cur : 0;
}

/** Set a value on an object using dot-notation path, creating intermediaries. */
export function setPath(obj: any, path: string, value: number) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] == null) cur[parts[i]] = {};
        cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
}
