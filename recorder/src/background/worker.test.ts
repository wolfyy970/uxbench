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
            expect(m.information_density).toBeDefined();
            expect(m.context_switches).toBeDefined();
            expect(m.shortcut_coverage).toBeDefined();
            expect(m.typing_ratio).toBeDefined();
            expect(m.navigation_depth.max_depth).toBe(1);
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
            expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#FF0000' });
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

            const expectedID = Math.log2(400 / 20 + 1);
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

        it('should write live stats to storage', async () => {
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

    describe('handleEvent — depth_update', () => {
        beforeEach(async () => { await sendMessage({ type: 'START_RECORDING' }); });

        it('should update navigation_depth metrics', async () => {
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'depth_update',
                    navigation_depth: {
                        max_depth: 3, total_depth_changes: 4, deepest_moment: 'modal > dropdown',
                        depth_path: [{ direction: 'open', layer: 'modal' }, { direction: 'open', layer: 'dropdown' }]
                    }
                }
            });

            const { recordingState, stats } = await chrome.storage.local.get(['recordingState', 'stats']);
            const nd = recordingState.currentRecording.metrics.navigation_depth;
            expect(nd.max_depth).toBe(3);
            expect(nd.deepest_moment).toBe('modal > dropdown');
            expect(stats.depth).toBe(3);
        });
    });

    describe('handleEvent — density_update', () => {
        beforeEach(async () => { await sendMessage({ type: 'START_RECORDING' }); });

        it('should update information_density metrics', async () => {
            await sendMessage({
                type: 'EVENT_CAPTURED',
                payload: {
                    type: 'density_update',
                    information_density: {
                        average_content_ratio: 0.65, min_content_ratio: 0.3, max_content_ratio: 0.9,
                        min_content_context: 'settings page', max_content_context: 'data table'
                    }
                }
            });

            const { recordingState } = await chrome.storage.local.get('recordingState');
            const id = recordingState.currentRecording.metrics.information_density;
            expect(id.average_content_ratio).toBe(0.65);
            expect(id.min_content_context).toBe('settings page');
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
