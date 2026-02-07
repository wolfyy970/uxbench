// Tests for the background service worker (worker.ts)
//
// Strategy: worker.ts is a side-effect module that registers chrome listeners
// at import time. We need to extract the worker's core functions for testing.
// Since we can't re-import easily, we'll test the worker logic by directly
// calling the functions through the captured chrome.runtime.onMessage listener.
//
// The mock setup happens in the global setup file. We rely on the fact that
// worker.ts uses `chrome.runtime.onMessage.addListener(fn)` — the mock captures
// the callback. We then call it directly.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { chrome } from '../__mocks__/chrome';

// The listener references — will be set after worker loads
type MessageListener = (message: any, sender: any, sendResponse: any) => void;
type CommandListener = (command: string) => void;
let onMessageListener: MessageListener;
let onCommandListener: CommandListener;

// Helper: reset storage directly
function resetStorage() {
    for (const key of Object.keys(chrome.storage.local._storage)) {
        delete chrome.storage.local._storage[key];
    }
}

// Re-wire all storage mock implementations
function rewireMocks() {
    chrome.storage.local.get.mockImplementation(async (keys: string | string[]) => {
        const keyList = typeof keys === 'string' ? [keys] : keys;
        const result: Record<string, any> = {};
        for (const key of keyList) {
            if (key in chrome.storage.local._storage) result[key] = chrome.storage.local._storage[key];
        }
        return result;
    });
    chrome.storage.local.set.mockImplementation(async (items: Record<string, any>) => {
        Object.assign(chrome.storage.local._storage, items);
    });
    chrome.storage.local.remove.mockImplementation(async (keys: string | string[]) => {
        const keyList = typeof keys === 'string' ? [keys] : keys;
        for (const key of keyList) delete chrome.storage.local._storage[key];
    });
    chrome.tabs.query.mockImplementation(async () => [{ id: 1, url: 'https://example.com' }]);
    chrome.tabs.sendMessage.mockImplementation(async () => { });
    chrome.runtime.sendMessage.mockImplementation(async () => { });
    chrome.action.setBadgeText.mockImplementation(async () => { });
    chrome.action.setBadgeBackgroundColor.mockImplementation(async () => { });
    chrome.sidePanel.setPanelBehavior.mockImplementation(() => { });
}

async function sendMessage(message: any) {
    onMessageListener(message, {}, () => { });
    await new Promise(r => setTimeout(r, 20));
}

async function sendCommand(command: string) {
    onCommandListener(command);
    await new Promise(r => setTimeout(r, 20));
}

describe('worker.ts', () => {
    // Import worker.ts once and capture listeners in the first beforeAll
    beforeAll(async () => {
        // Set up listener capture
        chrome.runtime.onMessage.addListener.mockImplementation((fn: MessageListener) => {
            onMessageListener = fn;
        });
        chrome.commands.onCommand.addListener.mockImplementation((fn: CommandListener) => {
            onCommandListener = fn;
        });
        rewireMocks();

        // Dynamic import to ensure our mock setup happens first
        await import('./worker');
    });

    beforeEach(() => {
        resetStorage();
        // Clear call counts but DON'T clear implementations
        chrome.storage.local.get.mockClear();
        chrome.storage.local.set.mockClear();
        chrome.storage.local.remove.mockClear();
        chrome.tabs.query.mockClear();
        chrome.tabs.sendMessage.mockClear();
        chrome.runtime.sendMessage.mockClear();
        chrome.action.setBadgeText.mockClear();
        chrome.action.setBadgeBackgroundColor.mockClear();
        vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('startRecording', () => {
        it('should initialize a schema-compliant recording in storage', async () => {
            await sendMessage({ type: 'START_RECORDING' });

            const { recordingState } = await chrome.storage.local.get('recordingState');
            expect(recordingState).toBeDefined();
            expect(recordingState.isRecording).toBe(true);
            expect(recordingState.startTime).toBeTypeOf('number');
            expect(recordingState.lastClickPosition).toBeNull();

            const rec = recordingState.currentRecording;
            expect(rec.schema_version).toBe('1.0');
            expect(rec.source).toBe('chrome-extension');
            expect(rec.metadata.timestamp).toBeTypeOf('string');
            expect(rec.metadata.duration_ms).toBe(0);
            expect(rec.metadata.operator).toBe('human');
            expect(rec.metadata.url).toBe('https://example.com');

            const m = rec.metrics;
            expect(m.click_count.total).toBe(0);
            expect(m.time_on_task).toBeDefined();
            expect(m.fitts.formula).toBe('shannon');
            expect(m.context_switches).toBeDefined();
            expect(m.shortcut_coverage).toBeDefined();
            expect(m.typing_ratio).toBeDefined();
            expect(m.scanning_distance).toBeDefined();
            expect(m.scroll_distance).toBeDefined();
            expect(m.composite_score).toBe(0);
            expect(rec.action_log).toEqual([]);
        });

        it('should clear previous stats and benchmarkReport', async () => {
            await chrome.storage.local.set({ stats: { clicks: 5 }, benchmarkReport: { old: true } });
            await sendMessage({ type: 'START_RECORDING' });

            const { stats, benchmarkReport } = await chrome.storage.local.get(['stats', 'benchmarkReport']);
            expect(stats).toBeNull();
            expect(benchmarkReport).toBeNull();
        });

        it('should notify content script via tabs.sendMessage', async () => {
            await sendMessage({ type: 'START_RECORDING' });
            expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, { type: 'RECORDING_STARTED' });
        });

        it('should notify side panel via runtime.sendMessage', async () => {
            await sendMessage({ type: 'START_RECORDING' });
            expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'RECORDING_STARTED' });
        });

        it('should set badge text when chrome.action is available', async () => {
            await sendMessage({ type: 'START_RECORDING' });
            expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: 'REC' });
            expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#EE6019' });
        });
    });

    describe('stopRecording', () => {
        it('should compute duration and generate benchmarkReport', async () => {
            await sendMessage({ type: 'START_RECORDING' });
            vi.advanceTimersByTime(5000);
            await sendMessage({ type: 'STOP_RECORDING' });

            const { benchmarkReport, recordingState } = await chrome.storage.local.get(
                ['benchmarkReport', 'recordingState']
            );
            expect(recordingState.isRecording).toBe(false);
            expect(benchmarkReport).toBeDefined();
            expect(benchmarkReport.metadata.duration_ms).toBeGreaterThanOrEqual(4500);
            expect(benchmarkReport.metrics.time_on_task.total_ms).toBeGreaterThanOrEqual(4500);
        });

        it('should write storage BEFORE sending notification messages', async () => {
            const callOrder: string[] = [];

            chrome.storage.local.set.mockImplementation(async (items: Record<string, any>) => {
                Object.assign(chrome.storage.local._storage, items);
                if (items.benchmarkReport !== undefined) callOrder.push('storage.set:report');
            });
            chrome.runtime.sendMessage.mockImplementation(async (msg: any) => {
                if (msg?.type === 'RECORDING_STOPPED') callOrder.push('runtime.sendMessage:stopped');
            });

            await sendMessage({ type: 'START_RECORDING' });
            callOrder.length = 0;
            await sendMessage({ type: 'STOP_RECORDING' });

            const setIdx = callOrder.indexOf('storage.set:report');
            const msgIdx = callOrder.indexOf('runtime.sendMessage:stopped');
            expect(setIdx).toBeGreaterThanOrEqual(0);
            expect(msgIdx).toBeGreaterThan(setIdx);

            // Restore original implementations
            rewireMocks();
        });

        it('should do nothing if not recording', async () => {
            await sendMessage({ type: 'STOP_RECORDING' });
            const { benchmarkReport } = await chrome.storage.local.get('benchmarkReport');
            expect(benchmarkReport).toBeUndefined();
        });

        it('should clear stats from storage', async () => {
            await sendMessage({ type: 'START_RECORDING' });
            await chrome.storage.local.set({ stats: { clicks: 3 } });
            await sendMessage({ type: 'STOP_RECORDING' });

            const { stats } = await chrome.storage.local.get('stats');
            expect(stats).toBeNull();
        });

        it('should notify both content script and side panel', async () => {
            await sendMessage({ type: 'START_RECORDING' });
            chrome.tabs.sendMessage.mockClear();
            chrome.runtime.sendMessage.mockClear();
            await sendMessage({ type: 'STOP_RECORDING' });

            expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, { type: 'RECORDING_STOPPED' });
            expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'RECORDING_STOPPED' });
        });
    });

    describe('handleEvent — click', () => {
        beforeEach(async () => {
            await sendMessage({ type: 'START_RECORDING' });
        });

        it('should increment click_count.total', async () => {
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'click', timestamp: Date.now(), x: 100, y: 200,
                    target: { tagName: 'BUTTON', id: 'btn1', innerText: 'Save', rect: { width: 80, height: 32 } }
                }
            });

            const { recordingState } = await chrome.storage.local.get('recordingState');
            expect(recordingState.currentRecording.metrics.click_count.total).toBe(1);
        });

        it('should compute Fitts ID and scanning distance between consecutive clicks', async () => {
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'click', timestamp: Date.now(), x: 100, y: 100,
                    target: { tagName: 'BUTTON', id: '', innerText: 'A', rect: { width: 80, height: 32 } }
                }
            });
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'click', timestamp: Date.now(), x: 500, y: 100,
                    target: { tagName: 'BUTTON', id: '', innerText: 'B', rect: { width: 40, height: 20 } }
                }
            });

            const { recordingState } = await chrome.storage.local.get('recordingState');
            const m = recordingState.currentRecording.metrics;

            expect(m.click_count.total).toBe(2);
            expect(m.scanning_distance.cumulative_px).toBe(400);
            expect(m.scanning_distance.average_px).toBe(400);

            // Welford directional target width: movement is purely horizontal (dx=400, dy=0)
            // angle = atan2(0, 400) = 0, so effective width = 40*cos(0) + 20*sin(0) = 40
            const expectedID = Math.log2(400 / 40 + 1);
            expect(m.fitts.cumulative_id).toBeCloseTo(expectedID, 2);
            expect(m.fitts.average_id).toBeCloseTo(expectedID, 2);
            expect(m.fitts.max_id).toBeCloseTo(expectedID, 2);
        });

        it('should track max Fitts ID element', async () => {
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'click', timestamp: Date.now(), x: 0, y: 0,
                    target: { tagName: 'DIV', id: '', innerText: 'Start', rect: { width: 100, height: 50 } }
                }
            });
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'click', timestamp: Date.now(), x: 1000, y: 500,
                    target: { tagName: 'BUTTON', id: 'tiny', innerText: 'Submit', rect: { width: 10, height: 10 } }
                }
            });

            const { recordingState } = await chrome.storage.local.get('recordingState');
            expect(recordingState.currentRecording.metrics.fitts.max_id_element).toBe('Submit');
            expect(recordingState.currentRecording.metrics.fitts.max_id_target_size).toBe('10x10px');
        });

        it('should append to action_log', async () => {
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'click', timestamp: 12345, x: 50, y: 50,
                    target: { tagName: 'A', id: 'link1', innerText: 'Home', rect: { width: 60, height: 20 } }
                }
            });

            const { recordingState } = await chrome.storage.local.get('recordingState');
            const log = recordingState.currentRecording.action_log;
            expect(log).toHaveLength(1);
            expect(log[0].target).toBe('A#link1');
            expect(log[0].text).toBe('Home');
        });

        it('should write live stats to storage with all metrics', async () => {
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'click', timestamp: Date.now(), x: 10, y: 10,
                    target: { tagName: 'DIV', id: '', innerText: '', rect: { width: 100, height: 50 } }
                }
            });

            const { stats } = await chrome.storage.local.get('stats');
            expect(stats).toBeDefined();
            expect(stats.clicks).toBe(1);
            // Expanded stats should include all metric fields
            expect(stats).toHaveProperty('scroll');
            expect(stats).toHaveProperty('switches');
            expect(stats).toHaveProperty('composite');
            expect(stats).toHaveProperty('fitts');
            expect(stats).toHaveProperty('shortcuts');
            expect(stats).toHaveProperty('typing');
            expect(stats).toHaveProperty('scanAvg');
            expect(stats).toHaveProperty('gaps');
        });

        it('should broadcast FEED_EVENT after click event', async () => {
            chrome.runtime.sendMessage.mockClear();
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'click', timestamp: Date.now(), x: 10, y: 10,
                    classification: 'productive',
                    target: { tagName: 'BUTTON', id: 'save', innerText: 'Save', rect: { width: 80, height: 32 } }
                }
            });

            const feedCalls = chrome.runtime.sendMessage.mock.calls.filter(
                (call: any[]) => call[0]?.type === 'FEED_EVENT'
            );
            expect(feedCalls.length).toBeGreaterThanOrEqual(1);
            const feedEvent = feedCalls[feedCalls.length - 1][0].event;
            expect(feedEvent.type).toBe('click');
            expect(feedEvent.label).toContain('CLICK');
            expect(feedEvent.label).toContain('BUTTON');
            expect(feedEvent.metricUpdates).toBeDefined();
            expect(feedEvent.metricUpdates.clicks).toBeDefined();
        });

        it('should include detail for wasted clicks in FEED_EVENT', async () => {
            chrome.runtime.sendMessage.mockClear();
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'click', timestamp: Date.now(), x: 10, y: 10,
                    classification: 'wasted', classificationReason: 'disabled element',
                    target: { tagName: 'BUTTON', id: '', innerText: 'Submit', rect: { width: 80, height: 32 } }
                }
            });

            const feedCalls = chrome.runtime.sendMessage.mock.calls.filter(
                (call: any[]) => call[0]?.type === 'FEED_EVENT'
            );
            expect(feedCalls.length).toBeGreaterThanOrEqual(1);
            const feedEvent = feedCalls[feedCalls.length - 1][0].event;
            expect(feedEvent.detail).toContain('wasted');
        });

        it('should not compute Fitts ID for first click', async () => {
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'click', timestamp: Date.now(), x: 100, y: 100,
                    target: { tagName: 'BUTTON', id: '', innerText: 'First', rect: { width: 80, height: 32 } }
                }
            });

            const { recordingState } = await chrome.storage.local.get('recordingState');
            expect(recordingState.currentRecording.metrics.fitts.cumulative_id).toBe(0);
            expect(recordingState.currentRecording.metrics.scanning_distance.cumulative_px).toBe(0);
        });
    });

    describe('handleEvent — scroll_update', () => {
        beforeEach(async () => { await sendMessage({ type: 'START_RECORDING' }); });

        it('should update scroll_distance metrics', async () => {
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'scroll_update', total_px: 1500, page_scroll_px: 1200,
                    container_scroll_px: 300, scroll_events: 12, heaviest_container: 'sidebar'
                }
            });

            const { recordingState, stats } = await chrome.storage.local.get(['recordingState', 'stats']);
            const sd = recordingState.currentRecording.metrics.scroll_distance;
            expect(sd.total_px).toBe(1500);
            expect(sd.page_scroll_px).toBe(1200);
            expect(sd.heaviest_container).toBe('sidebar');
            expect(stats.scroll).toBe(1500);
        });
    });

    describe('handleEvent — scroll FEED_EVENT throttling', () => {
        beforeEach(async () => { await sendMessage({ type: 'START_RECORDING' }); });

        it('should broadcast FEED_EVENT for scroll updates', async () => {
            chrome.runtime.sendMessage.mockClear();
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'scroll_update', total_px: 500, page_scroll_px: 500,
                    container_scroll_px: 0, scroll_events: 5
                }
            });

            const feedCalls = chrome.runtime.sendMessage.mock.calls.filter(
                (call: any[]) => call[0]?.type === 'FEED_EVENT'
            );
            expect(feedCalls.length).toBeGreaterThanOrEqual(1);
            const feedEvent = feedCalls[0][0].event;
            expect(feedEvent.type).toBe('scroll');
            expect(feedEvent.label).toContain('SCROLL');
        });
    });

    describe('handleEvent — keyboard_update', () => {
        beforeEach(async () => { await sendMessage({ type: 'START_RECORDING' }); });

        it('should update context_switches, shortcut_coverage, and typing_ratio', async () => {
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'keyboard_update',
                    context_switches: { total: 4, ratio: 0.2, longest_keyboard_streak: 10, longest_mouse_streak: 5 },
                    shortcut_coverage: { shortcuts_used: 3 },
                    typing_ratio: { free_text_inputs: 2, constrained_inputs: 1, ratio: 0.67, free_text_fields: ['Name', 'Email'] }
                }
            });

            const { recordingState, stats } = await chrome.storage.local.get(['recordingState', 'stats']);
            const m = recordingState.currentRecording.metrics;
            expect(m.context_switches.total).toBe(4);
            expect(m.shortcut_coverage.shortcuts_used).toBe(3);
            expect(m.typing_ratio.free_text_fields).toEqual(['Name', 'Email']);
            expect(stats.switches).toBe(4);
        });
    });

    describe('handleEvent — click classification', () => {
        beforeEach(async () => { await sendMessage({ type: 'START_RECORDING' }); });

        it('should count productive clicks', async () => {
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'click', timestamp: Date.now(), x: 10, y: 10,
                    classification: 'productive',
                    target: { tagName: 'BUTTON', id: 'ok', innerText: 'OK', rect: { width: 80, height: 32 } }
                }
            });

            const { recordingState } = await chrome.storage.local.get('recordingState');
            const cc = recordingState.currentRecording.metrics.click_count;
            expect(cc.total).toBe(1);
            expect(cc.productive).toBe(1);
            expect(cc.wasted).toBe(0);
            expect(cc.ceremonial).toBe(0);
        });

        it('should count wasted clicks and record details', async () => {
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'click', timestamp: Date.now(), x: 10, y: 10,
                    classification: 'wasted', classificationReason: 'disabled element',
                    target: { tagName: 'BUTTON', id: 'submit', innerText: 'Submit', rect: { width: 80, height: 32 } }
                }
            });

            const { recordingState } = await chrome.storage.local.get('recordingState');
            const cc = recordingState.currentRecording.metrics.click_count;
            expect(cc.wasted).toBe(1);
            expect(cc.wasted_details).toHaveLength(1);
            expect(cc.wasted_details[0].element).toBe('BUTTON#submit');
            expect(cc.wasted_details[0].reason).toBe('disabled element');
        });

        it('should count ceremonial clicks and record details', async () => {
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'click', timestamp: Date.now(), x: 10, y: 10,
                    classification: 'ceremonial', classificationReason: 'consent/cookie banner',
                    target: { tagName: 'BUTTON', id: '', innerText: 'Accept', rect: { width: 80, height: 32 } }
                }
            });

            const { recordingState } = await chrome.storage.local.get('recordingState');
            const cc = recordingState.currentRecording.metrics.click_count;
            expect(cc.ceremonial).toBe(1);
            expect(cc.ceremonial_details).toHaveLength(1);
            expect(cc.ceremonial_details[0].reason).toBe('consent/cookie banner');
        });
    });

    describe('handleEvent — idle gap detection', () => {
        beforeEach(async () => { await sendMessage({ type: 'START_RECORDING' }); });

        it('should detect idle gap when >3s passes between user actions', async () => {
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'click', timestamp: Date.now(), x: 10, y: 10,
                    target: { tagName: 'BUTTON', id: '', innerText: 'First', rect: { width: 80, height: 32 } }
                }
            });

            // Advance time beyond the 3s idle threshold
            vi.advanceTimersByTime(5000);

            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'click', timestamp: Date.now(), x: 20, y: 20,
                    target: { tagName: 'BUTTON', id: '', innerText: 'Second', rect: { width: 80, height: 32 } }
                }
            });

            const { recordingState } = await chrome.storage.local.get('recordingState');
            const gaps = recordingState.currentRecording.metrics.time_on_task.idle_gaps;
            expect(gaps.length).toBeGreaterThanOrEqual(1);
            expect(gaps[0].gap_ms).toBeGreaterThanOrEqual(4500);
        });

        it('should NOT detect idle gap for passive sensor events (mouse_travel)', async () => {
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'click', timestamp: Date.now(), x: 10, y: 10,
                    target: { tagName: 'BUTTON', id: '', innerText: 'A', rect: { width: 80, height: 32 } }
                }
            });

            // Advance time beyond idle threshold
            vi.advanceTimersByTime(5000);

            // Send passive sensor event — should NOT create idle gaps
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: { type: 'mouse_travel_update', total_px: 500, idle_travel_px: 200, move_events: 50, path_efficiency: null }
            });

            const { recordingState } = await chrome.storage.local.get('recordingState');
            const gaps = recordingState.currentRecording.metrics.time_on_task.idle_gaps;
            expect(gaps).toHaveLength(0);
        });
    });

    describe('stopRecording — idle/active time derivation', () => {
        it('should compute idle_ms and active_ms from idle gaps', async () => {
            await sendMessage({ type: 'START_RECORDING' });

            // Simulate a click, wait >3s, then another click to create an idle gap
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'click', timestamp: Date.now(), x: 10, y: 10,
                    target: { tagName: 'BUTTON', id: '', innerText: 'A', rect: { width: 80, height: 32 } }
                }
            });

            vi.advanceTimersByTime(5000);

            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'click', timestamp: Date.now(), x: 20, y: 20,
                    target: { tagName: 'BUTTON', id: '', innerText: 'B', rect: { width: 80, height: 32 } }
                }
            });

            vi.advanceTimersByTime(1000);
            await sendMessage({ type: 'STOP_RECORDING' });

            const { benchmarkReport } = await chrome.storage.local.get('benchmarkReport');
            expect(benchmarkReport).toBeDefined();
            const tot = benchmarkReport.metrics.time_on_task;
            expect(tot.idle_ms).toBeGreaterThan(0);
            expect(tot.active_ms).toBeDefined();
            expect(tot.active_ms).toBeLessThan(tot.total_ms);
            expect(tot.longest_idle_ms).toBeGreaterThan(0);
            expect(tot.longest_idle_after).toBeDefined();
        });
    });

    describe('handleEvent — mouse_travel_update', () => {
        beforeEach(async () => { await sendMessage({ type: 'START_RECORDING' }); });

        it('should update mouse_travel metrics in recording', async () => {
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'mouse_travel_update', total_px: 1200, idle_travel_px: 300,
                    move_events: 80, path_efficiency: null
                }
            });

            const { recordingState, stats } = await chrome.storage.local.get(['recordingState', 'stats']);
            const mt = recordingState.currentRecording.metrics.mouse_travel;
            expect(mt.total_px).toBe(1200);
            expect(mt.idle_travel_px).toBe(300);
            expect(mt.move_events).toBe(80);
            expect(stats.travel).toBe(1200);
        });

        it('should compute path_efficiency when scanning distance exists', async () => {
            // First create some scanning distance via two clicks
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'click', timestamp: Date.now(), x: 100, y: 100,
                    target: { tagName: 'BUTTON', id: '', innerText: 'A', rect: { width: 80, height: 32 } }
                }
            });
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'click', timestamp: Date.now(), x: 500, y: 100,
                    target: { tagName: 'BUTTON', id: '', innerText: 'B', rect: { width: 80, height: 32 } }
                }
            });

            // Now send mouse travel — path_efficiency = scanning / total_travel
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'mouse_travel_update', total_px: 800, idle_travel_px: 100,
                    move_events: 50, path_efficiency: null
                }
            });

            const { recordingState } = await chrome.storage.local.get('recordingState');
            const mt = recordingState.currentRecording.metrics.mouse_travel;
            // scanning_distance.cumulative_px = 400 (distance between two clicks)
            // path_efficiency = 400 / 800 = 0.5
            expect(mt.path_efficiency).toBeCloseTo(0.5, 2);
        });

        it('should broadcast FEED_EVENT for mouse travel', async () => {
            chrome.runtime.sendMessage.mockClear();
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'mouse_travel_update', total_px: 500, idle_travel_px: 100,
                    move_events: 30, path_efficiency: null
                }
            });

            const feedCalls = chrome.runtime.sendMessage.mock.calls.filter(
                (call: any[]) => call[0]?.type === 'FEED_EVENT'
            );
            expect(feedCalls.length).toBeGreaterThanOrEqual(1);
            const feedEvent = feedCalls[feedCalls.length - 1][0].event;
            expect(feedEvent.type).toBe('mouse_travel');
            expect(feedEvent.label).toContain('TRAVEL');
        });
    });

    describe('composite score', () => {
        beforeEach(async () => { await sendMessage({ type: 'START_RECORDING' }); });

        it('should compute composite from switches, fitts, and scroll only', async () => {
            // Generate 2 context switches via keyboard
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'keyboard_update',
                    context_switches: { total: 3, ratio: 0.2, longest_keyboard_streak: 5, longest_mouse_streak: 2 },
                    shortcut_coverage: { shortcuts_used: 1 },
                    typing_ratio: { free_text_inputs: 0, constrained_inputs: 0, ratio: 0, free_text_fields: [] }
                }
            });

            // Generate scroll
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: { type: 'scroll_update', total_px: 2000, page_scroll_px: 2000, container_scroll_px: 0, scroll_events: 10 }
            });

            // Generate clicks for Fitts
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'click', timestamp: Date.now(), x: 100, y: 100,
                    target: { tagName: 'BUTTON', id: '', innerText: 'A', rect: { width: 80, height: 32 } }
                }
            });
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'click', timestamp: Date.now(), x: 500, y: 100,
                    target: { tagName: 'BUTTON', id: '', innerText: 'B', rect: { width: 40, height: 20 } }
                }
            });

            const { stats } = await chrome.storage.local.get('stats');
            // composite = (switches * 1.5) + (fitts_cumulative * 1.0) + (scroll * 0.005)
            // = (3 * 1.5) + (fitts_id * 1.0) + (2000 * 0.005)
            // = 4.5 + fitts_id + 10
            expect(stats.composite).toBeGreaterThan(0);
            // It should NOT contain wait or depth components — verify lower bound
            // 3 switches * 1.5 = 4.5, 2000px scroll * 0.005 = 10, fitts > 0
            expect(stats.composite).toBeGreaterThanOrEqual(14);
        });
    });

    describe('startRecording — programmatic injection', () => {
        it('should inject content script via chrome.scripting.executeScript', async () => {
            chrome.scripting.executeScript.mockClear();
            await sendMessage({ type: 'START_RECORDING' });

            expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
                expect.objectContaining({
                    target: { tabId: 1 },
                    files: ['content-script.js']
                })
            );
        });
    });

    describe('handleEvent — ignored when not recording', () => {
        it('should not process events when not recording', async () => {
            await chrome.storage.local.set({ recordingState: { isRecording: false } });

            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'click', timestamp: Date.now(), x: 10, y: 10,
                    target: { tagName: 'BUTTON', id: '', innerText: 'X', rect: { width: 50, height: 30 } }
                }
            });

            const { stats } = await chrome.storage.local.get('stats');
            expect(stats).toBeUndefined();
        });
    });

    describe('keyboard shortcut — toggle-recording', () => {
        it('should start recording via command', async () => {
            await chrome.storage.local.set({ recordingState: { isRecording: false } });
            await sendCommand('toggle-recording');

            const { recordingState } = await chrome.storage.local.get('recordingState');
            expect(recordingState.isRecording).toBe(true);
        });

        it('should stop recording via command when already recording', async () => {
            await sendMessage({ type: 'START_RECORDING' });
            await new Promise(r => setTimeout(r, 30));
            await sendCommand('toggle-recording');

            const { benchmarkReport } = await chrome.storage.local.get('benchmarkReport');
            expect(benchmarkReport).toBeDefined();
        });
    });
});
