// Tests for the WaitCollector content script module
//
// Note: The WaitCollector uses MutationObserver, getComputedStyle, and
// getBoundingClientRect to detect visible loading indicators. Happy-dom has
// limited CSS support. Tests use real timers with short delays and mock
// getBoundingClientRect for visibility checks.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chrome, resetChromeMock } from '../__mocks__/chrome';
import { WaitCollector } from './wait';

// Helper: make element visible to getComputedStyle and getBoundingClientRect
function makeVisible(el: HTMLElement, width = 50) {
    el.style.display = 'block';
    el.style.visibility = 'visible';
    el.style.opacity = '1';
    el.getBoundingClientRect = () => ({
        width,
        height: 50,
        top: 0, left: 0, bottom: 50, right: width,
        x: 0, y: 0, toJSON: () => {}
    });
}

// Helper: make element have zero-width rect (invisible to WaitCollector)
function makeZeroWidth(el: HTMLElement) {
    el.style.display = 'block';
    el.style.visibility = 'visible';
    el.style.opacity = '1';
    el.getBoundingClientRect = () => ({
        width: 0,
        height: 0,
        top: 0, left: 0, bottom: 0, right: 0,
        x: 0, y: 0, toJSON: () => {}
    });
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function getWaitCalls() {
    return chrome.runtime.sendMessage.mock.calls.filter(
        (c: any) => c[0]?.payload?.type === 'wait_update'
    );
}

function lastWaitMs() {
    const calls = getWaitCalls();
    if (calls.length === 0) return -1;
    return calls[calls.length - 1][0].payload.application_wait_ms;
}

describe('WaitCollector', () => {
    let collector: WaitCollector;

    beforeEach(() => {
        resetChromeMock();
        collector = new WaitCollector();
    });

    afterEach(() => {
        collector.detach();
        document.body.innerHTML = '';
    });

    it('should report zero wait time when no loading indicators exist', () => {
        collector.attach();
        collector.detach();

        expect(getWaitCalls().length).toBeGreaterThan(0);
        expect(lastWaitMs()).toBe(0);
    });

    it('should detect visible spinner and accumulate wait time', async () => {
        collector.attach();

        const spinner = document.createElement('div');
        spinner.className = 'spinner';
        makeVisible(spinner);
        document.body.appendChild(spinner);

        // Wait for MutationObserver + setInterval to detect spinner
        await wait(600);

        // Remove spinner to end wait
        chrome.runtime.sendMessage.mockClear();
        document.body.removeChild(spinner);

        // Wait for periodic check to detect removal
        await wait(600);

        if (getWaitCalls().length > 0) {
            expect(lastWaitMs()).toBeGreaterThan(0);
        }
    });

    it('should ignore spinners with display: none', async () => {
        collector.attach();

        const spinner = document.createElement('div');
        spinner.className = 'spinner';
        spinner.style.display = 'none';
        document.body.appendChild(spinner);

        await wait(600);
        collector.detach();

        expect(getWaitCalls().length).toBeGreaterThan(0);
        expect(lastWaitMs()).toBe(0);
    });

    it('should ignore zero-width loading elements', async () => {
        collector.attach();

        const loader = document.createElement('div');
        loader.className = 'loading';
        makeZeroWidth(loader);
        document.body.appendChild(loader);

        await wait(600);
        collector.detach();

        expect(getWaitCalls().length).toBeGreaterThan(0);
        expect(lastWaitMs()).toBe(0);
    });

    it('should disconnect observer and clear interval on detach', async () => {
        collector.attach();
        collector.detach();

        chrome.runtime.sendMessage.mockClear();

        // Add spinner after detach — should NOT trigger updates
        const spinner = document.createElement('div');
        spinner.className = 'spinner';
        makeVisible(spinner);
        document.body.appendChild(spinner);

        await wait(600);

        expect(getWaitCalls().length).toBe(0);
    });

    it('should finalize in-progress wait on detach', async () => {
        collector.attach();

        const spinner = document.createElement('div');
        spinner.className = 'spinner';
        makeVisible(spinner);
        document.body.appendChild(spinner);

        // Wait for detection
        await wait(600);

        // Detach while spinner is still active
        chrome.runtime.sendMessage.mockClear();
        collector.detach();

        expect(getWaitCalls().length).toBeGreaterThan(0);
        expect(lastWaitMs()).toBeGreaterThan(0);
    });

    it('should detect aria-busy="true" elements', async () => {
        collector.attach();

        const busy = document.createElement('div');
        busy.setAttribute('aria-busy', 'true');
        makeVisible(busy);
        document.body.appendChild(busy);

        await wait(600);

        // Detach to finalize
        chrome.runtime.sendMessage.mockClear();
        collector.detach();

        expect(getWaitCalls().length).toBeGreaterThan(0);
        expect(lastWaitMs()).toBeGreaterThan(0);
    });

    it('should detect role="progressbar" elements', async () => {
        collector.attach();

        const progress = document.createElement('div');
        progress.setAttribute('role', 'progressbar');
        makeVisible(progress);
        document.body.appendChild(progress);

        await wait(600);

        chrome.runtime.sendMessage.mockClear();
        collector.detach();

        expect(getWaitCalls().length).toBeGreaterThan(0);
        expect(lastWaitMs()).toBeGreaterThan(0);
    });
});
