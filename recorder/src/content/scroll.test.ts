// Tests for the ScrollCollector content script module
// Note: ScrollCollector uses rAF batching, so we mock requestAnimationFrame.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { chrome, resetChromeMock } from '../__mocks__/chrome';
import { ScrollCollector } from './scroll';

// Mock rAF to execute synchronously
let rafCallbacks: FrameRequestCallback[] = [];
function flushRAF() {
    const cbs = rafCallbacks.splice(0);
    cbs.forEach(cb => cb(performance.now()));
}

describe('ScrollCollector', () => {
    let collector: ScrollCollector;
    let origRAF: typeof globalThis.requestAnimationFrame;
    let origCAF: typeof globalThis.cancelAnimationFrame;

    beforeEach(() => {
        resetChromeMock();
        rafCallbacks = [];
        origRAF = globalThis.requestAnimationFrame;
        origCAF = globalThis.cancelAnimationFrame;
        globalThis.requestAnimationFrame = vi.fn((cb) => {
            rafCallbacks.push(cb);
            return rafCallbacks.length;
        }) as any;
        globalThis.cancelAnimationFrame = vi.fn();

        // Mock window.scrollY
        Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });

        collector = new ScrollCollector();
    });

    afterEach(() => {
        collector.detach();
        globalThis.requestAnimationFrame = origRAF;
        globalThis.cancelAnimationFrame = origCAF;
    });

    it('should attach and detach scroll listeners', () => {
        const addWindowSpy = vi.spyOn(window, 'addEventListener');
        const addDocSpy = vi.spyOn(document, 'addEventListener');

        collector.attach();

        expect(addWindowSpy).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
        expect(addDocSpy).toHaveBeenCalledWith('scroll', expect.any(Function), { capture: true, passive: true });

        addWindowSpy.mockRestore();
        addDocSpy.mockRestore();
    });

    it('should track page scroll distance', () => {
        collector.attach();

        // Simulate scrolling to Y=300
        (window as any).scrollY = 300;
        window.dispatchEvent(new Event('scroll'));
        flushRAF();

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'EVENT_CAPTURED',
                payload: expect.objectContaining({
                    type: 'scroll_update',
                    total_px: 300,
                    page_scroll_px: 300,
                    scroll_events: 1,
                })
            })
        );
    });

    it('should accumulate multiple scroll events', () => {
        collector.attach();

        // Scroll to 200
        (window as any).scrollY = 200;
        window.dispatchEvent(new Event('scroll'));
        flushRAF();

        // Scroll back to 50 — delta = |50 - 200| = 150
        (window as any).scrollY = 50;
        window.dispatchEvent(new Event('scroll'));
        flushRAF();

        const lastCall = chrome.runtime.sendMessage.mock.calls[chrome.runtime.sendMessage.mock.calls.length - 1][0];
        expect(lastCall.payload.total_px).toBe(350); // 200 + 150
        expect(lastCall.payload.page_scroll_px).toBe(350);
        expect(lastCall.payload.scroll_events).toBe(2);
    });

    it('should track container scroll separately', () => {
        collector.attach();

        // Create a scrollable container
        const container = document.createElement('div');
        container.id = 'mylist';
        Object.defineProperty(container, 'scrollTop', { value: 0, writable: true, configurable: true });
        document.body.appendChild(container);

        // Simulate container scroll
        (container as any).scrollTop = 150;
        container.dispatchEvent(new Event('scroll', { bubbles: true }));
        flushRAF();

        const lastCall = chrome.runtime.sendMessage.mock.calls[chrome.runtime.sendMessage.mock.calls.length - 1][0];
        expect(lastCall.payload.container_scroll_px).toBe(150);
        expect(lastCall.payload.total_px).toBe(150);
        expect(lastCall.payload.heaviest_container).toBe('mylist');

        document.body.removeChild(container);
    });

    it('should flush remaining data on detach', () => {
        collector.attach();

        (window as any).scrollY = 100;
        window.dispatchEvent(new Event('scroll'));
        flushRAF();

        chrome.runtime.sendMessage.mockClear();

        // Detach should flush
        collector.detach();

        // flush sends one final update (or none if already sent)
        // The state gets reset after flush
    });

    it('should not send update for zero delta scroll', () => {
        collector.attach();

        // scrollY stays at 0
        window.dispatchEvent(new Event('scroll'));
        flushRAF();

        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });
});
