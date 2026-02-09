import { describe, it, expect } from 'vitest';
import { formatTaskTime, formatDuration, round2, formatCompact, getPath, setPath } from './utils';

describe('formatTaskTime', () => {
    it('should show decimal seconds for sub-minute values', () => {
        expect(formatTaskTime(0)).toBe('0.00s');
        expect(formatTaskTime(1500)).toBe('1.50s');
        expect(formatTaskTime(45678)).toBe('45.68s');
    });

    it('should show minutes and decimal remainder for >= 60s', () => {
        expect(formatTaskTime(60000)).toBe('1m 0.00s');
        expect(formatTaskTime(90000)).toBe('1m 30.00s');
        expect(formatTaskTime(125500)).toBe('2m 5.50s');
    });

    it('should handle sub-second precision', () => {
        expect(formatTaskTime(123)).toBe('0.12s');
        expect(formatTaskTime(999)).toBe('1.00s');
        expect(formatTaskTime(61050)).toBe('1m 1.05s');
    });
});

describe('formatDuration', () => {
    it('should show integer seconds for sub-minute values', () => {
        expect(formatDuration(0)).toBe('0s');
        expect(formatDuration(5000)).toBe('5s');
        expect(formatDuration(59999)).toBe('59s');
    });

    it('should show minutes and seconds for >= 60s', () => {
        expect(formatDuration(60000)).toBe('1m 0s');
        expect(formatDuration(90000)).toBe('1m 30s');
        expect(formatDuration(125000)).toBe('2m 5s');
    });
});

describe('round2', () => {
    it('should round to 2 decimal places', () => {
        expect(round2(3.14159)).toBe(3.14);
        expect(round2(42)).toBe(42);
        expect(round2(0.1 + 0.2)).toBe(0.3);
        expect(round2(1.456)).toBe(1.46);
    });
});

describe('formatCompact', () => {
    it('should return plain string below 1000', () => {
        expect(formatCompact(0)).toBe('0');
        expect(formatCompact(500)).toBe('500');
        expect(formatCompact(999)).toBe('999');
    });

    it('should format >= 1000 with k suffix', () => {
        expect(formatCompact(1000)).toBe('1k');
        expect(formatCompact(1500)).toBe('1.5k');
        expect(formatCompact(25678)).toBe('25.68k');
    });
});

describe('getPath', () => {
    it('should read nested values', () => {
        expect(getPath({ a: { b: 42 } }, 'a.b')).toBe(42);
    });

    it('should return 0 for missing paths', () => {
        expect(getPath({}, 'a.b.c')).toBe(0);
        expect(getPath(null, 'a')).toBe(0);
    });

    it('should return 0 for non-numeric values', () => {
        expect(getPath({ a: 'hello' }, 'a')).toBe(0);
    });

    it('should read top-level values', () => {
        expect(getPath({ score: 7.5 }, 'score')).toBe(7.5);
    });
});

describe('setPath', () => {
    it('should set nested values, creating intermediaries', () => {
        const obj: any = {};
        setPath(obj, 'a.b.c', 99);
        expect(obj.a.b.c).toBe(99);
    });

    it('should overwrite existing values', () => {
        const obj = { a: { b: 1 } };
        setPath(obj, 'a.b', 2);
        expect(obj.a.b).toBe(2);
    });

    it('should set top-level values', () => {
        const obj: any = {};
        setPath(obj, 'score', 42);
        expect(obj.score).toBe(42);
    });
});
