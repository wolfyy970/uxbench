// Tests for the MouseTravelCollector content script module

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { chrome, resetChromeMock } from '../__mocks__/chrome';
import { MouseTravelCollector } from './mouse-travel';

// Mock rAF to execute synchronously
let rafCallbacks: FrameRequestCallback[] = [];
function flushRAF() {
    const cbs = rafCallbacks.splice(0);
    cbs.forEach(cb => cb(performance.now()));
}

describe('MouseTravelCollector', () => {
    let collector: MouseTravelCollector;
    let origRAF: typeof globalThis.requestAnimationFrame;
    let origCAF: typeof globalThis.cancelAnimationFrame;

    beforeEach(() => {
        vi.useFakeTimers();
        resetChromeMock();
        rafCallbacks = [];
        origRAF = globalThis.requestAnimationFrame;
        origCAF = globalThis.cancelAnimationFrame;
        globalThis.requestAnimationFrame = vi.fn((cb) => {
            rafCallbacks.push(cb);
            return rafCallbacks.length;
        }) as any;
        globalThis.cancelAnimationFrame = vi.fn();

        collector = new MouseTravelCollector();
    });

    afterEach(() => {
        collector.detach();
        globalThis.requestAnimationFrame = origRAF;
        globalThis.cancelAnimationFrame = origCAF;
        vi.useRealTimers();
    });

    it('should attach and detach mousemove listener', () => {
        const addSpy = vi.spyOn(document, 'addEventListener');
        const removeSpy = vi.spyOn(document, 'removeEventListener');

        collector.attach();
        expect(addSpy).toHaveBeenCalledWith('mousemove', expect.any(Function), { capture: true, passive: true });

        collector.detach();
        expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function), { capture: true });

        addSpy.mockRestore();
        removeSpy.mockRestore();
    });

    it('should not send update on first mousemove (establishes baseline)', () => {
        collector.attach();

        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 200 }));
        flushRAF();
        // Advance past throttle
        vi.advanceTimersByTime(600);

        // First move only records position — no delta, no message
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('should compute euclidean distance between consecutive moves', () => {
        collector.attach();

        // First move — baseline
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 0, clientY: 0 }));
        flushRAF();
        vi.advanceTimersByTime(600);

        // Second move — delta should be 500 (300² + 400² = 250000, √250000 = 500)
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 400 }));
        flushRAF();
        vi.advanceTimersByTime(600);

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'EVENT_CAPTURED',
                payload: expect.objectContaining({
                    type: 'mouse_travel_update',
                    total_px: 500,
                    move_events: 2, // first (baseline) + second (actual move)
                })
            })
        );
    });

    it('should accumulate travel distance across multiple moves', () => {
        collector.attach();

        // Move 1: baseline at (0,0)
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 0, clientY: 0 }));
        flushRAF();
        vi.advanceTimersByTime(600);

        // Move 2: horizontal +100px
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 0 }));
        flushRAF();
        vi.advanceTimersByTime(600);

        // Move 3: vertical +100px
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 100 }));
        flushRAF();
        vi.advanceTimersByTime(600);

        const lastCall = chrome.runtime.sendMessage.mock.calls[chrome.runtime.sendMessage.mock.calls.length - 1][0];
        expect(lastCall.payload.total_px).toBe(200); // 100 + 100
    });

    it('should track idle travel and reset segment on notifyClick', () => {
        collector.attach();

        // Baseline
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 0, clientY: 0 }));
        flushRAF();
        vi.advanceTimersByTime(600);

        // Move 100px — this segment is "idle" until a click occurs
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 0 }));
        flushRAF();
        vi.advanceTimersByTime(600);

        // Simulate a click — marks current segment as productive, resets segment counter
        collector.notifyClick();

        // Move another 50px — new segment, no click yet (idle)
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, clientY: 0 }));
        flushRAF();
        vi.advanceTimersByTime(600);

        const lastCall = chrome.runtime.sendMessage.mock.calls[chrome.runtime.sendMessage.mock.calls.length - 1][0];
        // Total travel = 100 + 50 = 150
        expect(lastCall.payload.total_px).toBe(150);
        // Idle travel = only the 50px after the click (the 100px segment was productive)
        expect(lastCall.payload.idle_travel_px).toBe(50);
    });

    it('should flush remaining data on detach', () => {
        collector.attach();

        // Baseline
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 0, clientY: 0 }));
        flushRAF();

        // Move 200px — this is still pending
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 0 }));
        flushRAF();

        chrome.runtime.sendMessage.mockClear();

        // Detach should flush final update
        collector.detach();

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                payload: expect.objectContaining({
                    type: 'mouse_travel_update',
                    total_px: 200,
                })
            })
        );
    });

    it('should throttle messages (500ms minimum between sends)', () => {
        collector.attach();

        // Baseline at t=0
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 0, clientY: 0 }));
        flushRAF();

        // Advance past throttle (t=600) then first real move — should send
        vi.advanceTimersByTime(600);
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 0 }));
        flushRAF();

        const callCount1 = chrome.runtime.sendMessage.mock.calls.length;
        expect(callCount1).toBe(1);

        // Immediate second move at same time — within throttle window — should NOT send
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 0 }));
        flushRAF();

        const callCount2 = chrome.runtime.sendMessage.mock.calls.length;
        expect(callCount2).toBe(1); // still 1, throttled

        // Advance past throttle and trigger another move — should send
        vi.advanceTimersByTime(600);
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 0 }));
        flushRAF();

        expect(chrome.runtime.sendMessage.mock.calls.length).toBeGreaterThan(callCount2);
    });
});
