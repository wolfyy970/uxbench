/// <reference types="chrome"/>

import type { TaskPayload, TaskSnapshot } from "../core";

interface RecordingState {
    isRecording: boolean;
    recordingTabId?: number;
    startTime?: number;
}

interface HarnessFeed {
    type: string;
    label: string;
    detail?: string;
}

const BRAND_ORANGE = "#EE6019";
const NOOP = () => {};

const initialState: RecordingState = { isRecording: false };
let isTransitioning = false;
let feedCounter = 0;

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ recordingState: initialState });
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "toggle-recording") return;
    const { recordingState } = await chrome.storage.local.get("recordingState");
    if (recordingState?.isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
});

chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
    if (message.type === "START_RECORDING" && !isTransitioning) {
        isTransitioning = true;
        startRecording().finally(() => {
            isTransitioning = false;
        });
    } else if (message.type === "STOP_RECORDING" && !isTransitioning) {
        isTransitioning = true;
        stopRecording().finally(() => {
            isTransitioning = false;
        });
    } else if (message.type === "HARNESS_SNAPSHOT") {
        handleHarnessSnapshot(message.snapshot, message.feed);
    }
});

async function startRecording() {
    console.log("UXBench: Starting recording...");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const now = Date.now();
    feedCounter = 0;

    const state: RecordingState = {
        isRecording: true,
        recordingTabId: tab?.id,
        startTime: now,
    };

    await chrome.storage.local.set({
        recordingState: state,
        stats: null,
        benchmarkReport: null,
    });

    if (tab?.id) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ["content-script.js"],
            });
        } catch {
            // chrome:// and other restricted pages cannot receive content scripts.
        }
        chrome.tabs.sendMessage(tab.id, { type: "RECORDING_STARTED" }).catch(NOOP);
    }

    if (chrome.action) {
        chrome.action.setBadgeText({ text: "REC" }).catch(NOOP);
        chrome.action.setBadgeBackgroundColor({ color: BRAND_ORANGE }).catch(NOOP);
    }

    chrome.runtime.sendMessage({ type: "RECORDING_STARTED" }).catch(NOOP);
}

async function stopRecording() {
    console.log("UXBench: Stopping recording...");
    const { recordingState } = await chrome.storage.local.get("recordingState");
    if (!recordingState?.isRecording) return;

    const recordingTabId = await getRecordingTabId(recordingState);
    const report = recordingTabId === undefined ? null : await flushAndStopContentScript(recordingTabId);

    const finalState: RecordingState = { isRecording: false };

    await chrome.storage.local.set({
        recordingState: finalState,
        benchmarkReport: report || null,
        stats: null,
    });

    if (recordingTabId !== undefined) {
        chrome.tabs.sendMessage(recordingTabId, { type: "RECORDING_STOPPED" }).catch(NOOP);
    }

    if (chrome.action) {
        chrome.action.setBadgeText({ text: "" }).catch(NOOP);
    }

    chrome.runtime.sendMessage({ type: "RECORDING_STOPPED" }).catch(NOOP);
}

async function getRecordingTabId(recordingState: RecordingState): Promise<number | undefined> {
    if (recordingState.recordingTabId !== undefined) return recordingState.recordingTabId;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
}

async function flushAndStopContentScript(tabId: number): Promise<TaskPayload | null> {
    try {
        const response = await chrome.tabs.sendMessage(tabId, { type: "FLUSH_AND_STOP_RECORDING" });
        return response?.payload || null;
    } catch {
        return null;
    }
}

async function handleHarnessSnapshot(snapshot: TaskSnapshot, feed?: HarnessFeed) {
    const { recordingState } = await chrome.storage.local.get("recordingState");
    if (!recordingState?.isRecording) return;

    const stats = snapshotToStats(snapshot);
    await chrome.storage.local.set({ stats });

    if (feed) {
        chrome.runtime
            .sendMessage({
                type: "FEED_EVENT",
                event: {
                    id: ++feedCounter,
                    ts: Date.now(),
                    type: feed.type,
                    label: feed.label,
                    detail: feed.detail,
                    metricUpdates: buildMetricUpdates(snapshot),
                },
            })
            .catch(NOOP);
    }
}

function snapshotToStats(snapshot: TaskSnapshot) {
    return {
        taskTime: formatTaskTime(snapshot.total_ms),
        clicks: snapshot.metrics.clicks.total,
        scroll: Math.round(snapshot.metrics.scroll.total_px),
        switches: snapshot.metrics.input.context_switches,
        fitts: round2(snapshot.metrics.target_effort.average_id),
        shortcuts: snapshot.metrics.input.shortcuts_used,
        travel: Math.round(snapshot.metrics.cursor.total_px),
        gaps: snapshot.idle_gap_count,
    };
}

function buildMetricUpdates(snapshot: TaskSnapshot): Record<string, { value: string }> {
    const stats = snapshotToStats(snapshot);
    return {
        taskTime: { value: stats.taskTime },
        clicks: { value: stats.clicks.toString() },
        scroll: { value: formatCompact(stats.scroll) },
        switches: { value: stats.switches.toString() },
        fitts: { value: stats.fitts.toString() },
        shortcuts: { value: stats.shortcuts.toString() },
        travel: { value: formatCompact(stats.travel) },
        gaps: { value: stats.gaps.toString() },
    };
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function formatCompact(value: number): string {
    if (value >= 1000) return round2(value / 1000) + "k";
    return value.toString();
}

function formatTaskTime(ms: number): string {
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(2)}s`;
    const mins = Math.floor(seconds / 60);
    const remaining = seconds - mins * 60;
    return `${mins}m ${remaining.toFixed(2)}s`;
}
