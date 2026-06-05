import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chrome } from "../__mocks__/chrome";
import type { TaskPayload, TaskSnapshot } from "../core";

type MessageListener = (message: any, sender: any, sendResponse: any) => void;
type CommandListener = (command: string) => void;

let onMessageListener: MessageListener;
let onCommandListener: CommandListener;

function resetStorage() {
    for (const key of Object.keys(chrome.storage.local._storage)) {
        delete chrome.storage.local._storage[key];
    }
}

function rewireMocks() {
    chrome.storage.local.get.mockImplementation(async (keys: string | string[]) => {
        const keyList = typeof keys === "string" ? [keys] : keys;
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
        const keyList = typeof keys === "string" ? [keys] : keys;
        for (const key of keyList) delete chrome.storage.local._storage[key];
    });
    chrome.tabs.query.mockImplementation(async () => [{ id: 1, url: "https://example.com" }]);
    chrome.tabs.sendMessage.mockImplementation(async () => {});
    chrome.runtime.sendMessage.mockImplementation(async () => {});
    chrome.action.setBadgeText.mockImplementation(async () => {});
    chrome.action.setBadgeBackgroundColor.mockImplementation(async () => {});
    chrome.sidePanel.setPanelBehavior.mockImplementation(() => {});
}

async function sendMessage(message: any) {
    onMessageListener(message, {}, () => {});
    await new Promise((resolve) => setTimeout(resolve, 20));
}

async function sendCommand(command: string) {
    onCommandListener(command);
    await new Promise((resolve) => setTimeout(resolve, 20));
}

function samplePayload(): TaskPayload {
    return {
        schema_version: "3.0",
        source: "chrome-extension",
        app: "UX Bench Harness",
        session_id: "session",
        task_id: "harness-recording",
        task_run_id: "run",
        status: "completed",
        started_at: "2026-06-05T12:00:00.000Z",
        ended_at: "2026-06-05T12:00:05.000Z",
        duration_ms: 5000,
        total_ms: 5000,
        active_ms: 5000,
        idle_ms: 0,
        idle_gap_count: 0,
        dimensions: { url: "https://example.com" },
        metrics: {
            clicks: { total: 1, ceremonial: 0, wasted: 0 },
            target_effort: { average_id: 0, max_id: 0, max_distance_px: 0, max_target_width_px: 0 },
            scroll: { total_px: 0, page_px: 0, container_px: 0, horizontal_px: 0 },
            cursor: { total_px: 0, move_events: 0 },
            input: {
                context_switches: 0,
                longest_keyboard_streak: 0,
                longest_mouse_streak: 1,
                shortcuts_used: 0,
            },
        },
    };
}

function sampleSnapshot(): TaskSnapshot {
    return {
        task_id: "harness-recording",
        task_run_id: "run",
        elapsed_ms: 1234,
        total_ms: 1234,
        active_ms: 1234,
        idle_ms: 0,
        idle_gap_count: 0,
        metrics: {
            clicks: { total: 2, ceremonial: 1, wasted: 0 },
            target_effort: { average_id: 1.25, max_id: 2, max_distance_px: 100, max_target_width_px: 40 },
            scroll: { total_px: 1500, page_px: 1000, container_px: 500, horizontal_px: 0 },
            cursor: { total_px: 800, move_events: 4 },
            input: {
                context_switches: 3,
                longest_keyboard_streak: 2,
                longest_mouse_streak: 4,
                shortcuts_used: 1,
            },
        },
    };
}

describe("worker.ts", () => {
    beforeAll(async () => {
        chrome.runtime.onMessage.addListener.mockImplementation((fn: MessageListener) => {
            onMessageListener = fn;
        });
        chrome.commands.onCommand.addListener.mockImplementation((fn: CommandListener) => {
            onCommandListener = fn;
        });
        rewireMocks();
        await import("./worker.js");
    });

    beforeEach(() => {
        resetStorage();
        chrome.storage.local.get.mockClear();
        chrome.storage.local.set.mockClear();
        chrome.storage.local.remove.mockClear();
        chrome.tabs.query.mockClear();
        chrome.tabs.sendMessage.mockClear();
        chrome.runtime.sendMessage.mockClear();
        chrome.action.setBadgeText.mockClear();
        chrome.action.setBadgeBackgroundColor.mockClear();
    });

    afterEach(() => {
        rewireMocks();
    });

    it("starts a recording and notifies the original tab and side panel", async () => {
        await sendMessage({ type: "START_RECORDING" });

        const { recordingState, stats, benchmarkReport } = await chrome.storage.local.get([
            "recordingState",
            "stats",
            "benchmarkReport",
        ]);
        expect(recordingState.isRecording).toBe(true);
        expect(recordingState.recordingTabId).toBe(1);
        expect(recordingState.startTime).toBeTypeOf("number");
        expect(stats).toBeNull();
        expect(benchmarkReport).toBeNull();
        expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
            expect.objectContaining({ target: { tabId: 1 }, files: ["content-script.js"] }),
        );
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, { type: "RECORDING_STARTED" });
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "RECORDING_STARTED" });
    });

    it("stores live snapshots and forwards feed events", async () => {
        await sendMessage({ type: "START_RECORDING" });
        chrome.runtime.sendMessage.mockClear();

        await sendMessage({
            type: "HARNESS_SNAPSHOT",
            snapshot: sampleSnapshot(),
            feed: { type: "click", label: "CLICK (2)", detail: "BUTTON#save" },
        });

        const { stats } = await chrome.storage.local.get("stats");
        expect(stats).toMatchObject({
            clicks: 2,
            scroll: 1500,
            switches: 3,
            fitts: 1.25,
            shortcuts: 1,
            travel: 800,
            gaps: 0,
        });
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "FEED_EVENT",
                event: expect.objectContaining({
                    type: "click",
                    label: "CLICK (2)",
                    metricUpdates: expect.objectContaining({ clicks: { value: "2" } }),
                }),
            }),
        );
    });

    it("stops the original recording tab and stores the completed task payload", async () => {
        chrome.tabs.query.mockImplementationOnce(async () => [{ id: 10, url: "https://start.example" }]);
        await sendMessage({ type: "START_RECORDING" });

        chrome.tabs.sendMessage.mockClear();
        chrome.tabs.query.mockImplementation(async () => [{ id: 99, url: "https://other.example" }]);
        chrome.tabs.sendMessage.mockImplementation(async (_tabId: number, message: any) => {
            if (message.type === "FLUSH_AND_STOP_RECORDING") return { ok: true, payload: samplePayload() };
            return undefined;
        });

        await sendMessage({ type: "STOP_RECORDING" });

        const { recordingState, benchmarkReport, stats } = await chrome.storage.local.get([
            "recordingState",
            "benchmarkReport",
            "stats",
        ]);
        expect(recordingState.isRecording).toBe(false);
        expect(benchmarkReport.schema_version).toBe("3.0");
        expect(stats).toBeNull();
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(10, { type: "FLUSH_AND_STOP_RECORDING" });
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(10, { type: "RECORDING_STOPPED" });
    });

    it("writes the report before sending the stopped notification", async () => {
        const callOrder: string[] = [];

        chrome.storage.local.set.mockImplementation(async (items: Record<string, any>) => {
            Object.assign(chrome.storage.local._storage, items);
            if (items.benchmarkReport !== undefined) callOrder.push("storage.set:report");
        });
        chrome.runtime.sendMessage.mockImplementation(async (message: any) => {
            if (message.type === "RECORDING_STOPPED") callOrder.push("runtime.sendMessage:stopped");
        });
        chrome.tabs.sendMessage.mockImplementation(async (_tabId: number, message: any) => {
            if (message.type === "FLUSH_AND_STOP_RECORDING") return { ok: true, payload: samplePayload() };
            return undefined;
        });

        await sendMessage({ type: "START_RECORDING" });
        callOrder.length = 0;
        await sendMessage({ type: "STOP_RECORDING" });

        expect(callOrder.indexOf("storage.set:report")).toBeGreaterThanOrEqual(0);
        expect(callOrder.indexOf("runtime.sendMessage:stopped")).toBeGreaterThan(
            callOrder.indexOf("storage.set:report"),
        );
    });

    it("toggles recording from the keyboard command", async () => {
        await chrome.storage.local.set({ recordingState: { isRecording: false } });
        await sendCommand("toggle-recording");
        expect((await chrome.storage.local.get("recordingState")).recordingState.isRecording).toBe(true);

        chrome.tabs.sendMessage.mockImplementation(async (_tabId: number, message: any) => {
            if (message.type === "FLUSH_AND_STOP_RECORDING") return { ok: true, payload: samplePayload() };
            return undefined;
        });
        await sendCommand("toggle-recording");
        expect((await chrome.storage.local.get("recordingState")).recordingState.isRecording).toBe(false);
    });
});
