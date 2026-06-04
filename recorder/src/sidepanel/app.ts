/// <reference types="chrome"/>
import { formatTaskTime, formatCompact } from "./utils";
import { buildAveragedReport, generateMarkdownReport, type BenchmarkReport } from "./report";

/** FEED_EVENT pushed from the worker for real-time display */
interface FeedEvent {
    id: number;
    ts: number;
    type: string;
    label: string;
    detail?: string;
    metricUpdates?: Record<string, { value: string }>;
}

/** Live stats snapshot stored by the worker for recovery */
interface LiveStats {
    clicks: number;
    scroll: number;
    switches: number;
    fitts: number;
    shortcuts: number;
    typing: number;
    scanAvg: number;
    travel: number;
    gaps: number;
}

// --- Element References ---
const actionBtn = document.getElementById("actionBtn") as HTMLButtonElement;
const downloadBtn = document.getElementById("downloadBtn") as HTMLButtonElement;
const clearBtn = document.getElementById("clearBtn") as HTMLButtonElement;
const formatSelect = document.getElementById("formatSelect") as HTMLSelectElement;
const resSelect = document.getElementById("resSelect") as HTMLSelectElement;
const liveTime = document.getElementById("liveTime") as HTMLSpanElement;
const statusText = document.getElementById("statusText") as HTMLSpanElement;
const btnRow = document.querySelector(".btn-row") as HTMLDivElement;
const feedEl = document.getElementById("feed") as HTMLDivElement;

// Metric display elements (all 9 metrics)
const metricEls: Record<string, HTMLSpanElement | null> = {
    taskTime: document.getElementById("mTaskTime"),
    gaps: document.getElementById("mGaps"),
    clicks: document.getElementById("mClicks"),
    fitts: document.getElementById("mFitts"),
    travel: document.getElementById("mTravel"),
    scanAvg: document.getElementById("mScan"),
    scroll: document.getElementById("mScroll"),
    switches: document.getElementById("mSwitches"),
    shortcuts: document.getElementById("mShortcuts"),
    typing: document.getElementById("mTyping"),
};

// Base CSS class for all metric value elements (preserves t-mono utility)
const METRIC_VAL_BASE = "metric-val t-mono";

let clockInterval: ReturnType<typeof setInterval> | null = null;
let sessionRuns: BenchmarkReport[] = [];
let recordingStartTime = 0;
const FEED_MAX = 200;

// ========================================================
// STATE MACHINE
//
// Panel states:
//   COLD_START  — no viewport selected, no runs
//   READY       — viewport selected, can start recording
//   STARTING    — START clicked, waiting for worker ACK
//   RECORDING   — actively recording
//   STOPPING    — STOP clicked, waiting for worker ACK
//   HAS_RUNS    — ≥1 completed run, not recording
//
// Inputs that drive transitions:
//   - resSelect change          → recompute
//   - actionBtn click           → STARTING or STOPPING
//   - RECORDING_STARTED message → RECORDING
//   - RECORDING_STOPPED message → HAS_RUNS
//   - clearBtn click            → COLD_START or READY
//   - init (panel open)         → any state based on stored data
// ========================================================

type PanelState = "COLD_START" | "READY" | "STARTING" | "RECORDING" | "STOPPING" | "HAS_RUNS";

function deriveState(): PanelState {
    const isRecording = document.body.classList.contains("recording");
    const viewportSelected = resSelect.value !== "";
    const hasRuns = sessionRuns.length > 0;

    if (isRecording) return "RECORDING";
    if (hasRuns) return "HAS_RUNS";
    if (viewportSelected) return "READY";
    return "COLD_START";
}

// Transient states (STARTING / STOPPING) are set explicitly and
// override deriveState() until the worker responds.
let transientState: "STARTING" | "STOPPING" | null = null;

function currentState(): PanelState {
    return transientState ?? deriveState();
}

function applyState() {
    const state = currentState();
    const recording = state === "RECORDING" || state === "STARTING";

    // --- Feed null state ---
    // Only update when the feed has no event entries (fresh, reset, or panel reopened)
    const feedHasContent =
        feedEl.querySelector(".feed-entry") !== null || feedEl.querySelector(".feed-complete") !== null;
    if (!feedHasContent && !recording) {
        renderFeedNullState();
    }

    // --- Status bar ---
    // Status text
    if (statusText) {
        switch (state) {
            case "COLD_START":
                statusText.textContent = "Ready";
                break;
            case "READY":
                statusText.textContent = "Ready";
                break;
            case "STARTING":
                statusText.textContent = "Starting\u2026";
                break;
            case "RECORDING":
                statusText.textContent = "Recording";
                break;
            case "STOPPING":
                statusText.textContent = "Stopping\u2026";
                break;
            case "HAS_RUNS":
                statusText.textContent = "Ready";
                break;
        }
    }

    // Time: only visible while recording
    if (liveTime) liveTime.style.display = recording ? "" : "none";

    // --- Action button ---
    switch (state) {
        case "COLD_START":
            actionBtn.textContent = "Start \u2318\u21e7R";
            actionBtn.disabled = true;
            break;
        case "READY":
            actionBtn.textContent = "Start \u2318\u21e7R";
            actionBtn.disabled = false;
            break;
        case "STARTING":
            actionBtn.textContent = "Starting\u2026";
            actionBtn.disabled = true;
            break;
        case "RECORDING":
            actionBtn.textContent = "Stop \u2318\u21e7R";
            actionBtn.disabled = false;
            break;
        case "STOPPING":
            actionBtn.textContent = "Stopping\u2026";
            actionBtn.disabled = true;
            break;
        case "HAS_RUNS":
            actionBtn.textContent = "Start \u2318\u21e7R";
            actionBtn.disabled = resSelect.value === "";
            break;
    }

    // --- Download row: only visible when there are completed runs and not recording ---
    const showBtnRow = state === "HAS_RUNS";
    btnRow.style.display = showBtnRow ? "" : "none";
    downloadBtn.disabled = !showBtnRow;
    formatSelect.disabled = !showBtnRow;
    clearBtn.disabled = !showBtnRow;

    // --- Viewport select: locked while recording or transitioning ---
    resSelect.disabled = state === "RECORDING" || state === "STARTING" || state === "STOPPING";
}

// --- Feed Null State ---
// Renders contextual null state in the feed area when no events are present.
// Two variants: fresh session ("Run 1") vs. completed runs ("N runs recorded").
function renderFeedNullState() {
    const nextRun = sessionRuns.length + 1;
    const runsNote =
        sessionRuns.length > 0 ? `${sessionRuns.length} run${sessionRuns.length > 1 ? "s" : ""} recorded \u00b7 ` : "";
    feedEl.innerHTML =
        '<div class="feed-null">' +
        '<span class="feed-null-label">Get ready for</span>' +
        `<span class="feed-null-run">Run ${nextRun}</span>` +
        `<span class="feed-null-hint">${runsNote}Multiple runs are averaged<br>for reliable metrics.</span>` +
        "</div>";
}

// --- Resolution Logic ---
resSelect.addEventListener("change", async (e) => {
    applyState();

    const target = (e.target as HTMLSelectElement).value;
    if (!target) return;

    const [wStr, hStr] = target.split("x");
    const targetW = parseInt(wStr);
    const targetH = parseInt(hStr);

    try {
        const windowObj = await chrome.windows.getCurrent();
        const [tab] = await chrome.tabs.query({ active: true, windowId: windowObj.id });

        if (!tab?.id || !windowObj.id) return;

        // chrome.scripting.executeScript cannot run on chrome:// or edge:// pages
        if (tab.url && (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://"))) {
            console.warn("UXBench: Cannot resize viewport on a browser internal page. Navigate to a website first.");
            return;
        }

        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => ({ w: window.innerWidth, h: window.innerHeight }),
        });

        const viewport = results[0].result;
        if (!viewport) return;

        const deltaW = targetW - viewport.w;
        const deltaH = targetH - viewport.h;

        await chrome.windows.update(windowObj.id, {
            width: (windowObj.width || 0) + deltaW,
            height: (windowObj.height || 0) + deltaH,
            state: "normal",
        });
    } catch (err) {
        console.warn("UXBench: Could not resize viewport —", (err as Error).message);
    }
});

// --- Action (Start/Stop) Logic ---
actionBtn.addEventListener("click", () => {
    if (actionBtn.disabled) return;

    const state = currentState();

    if (state === "RECORDING") {
        transientState = "STOPPING";
        applyState();
        chrome.runtime.sendMessage({ type: "STOP_RECORDING" });
    } else if (state === "READY" || state === "HAS_RUNS") {
        transientState = "STARTING";
        applyState();
        chrome.runtime.sendMessage({ type: "START_RECORDING" });
    }
});

// --- Clear Logic ---
clearBtn.addEventListener("click", () => {
    sessionRuns = [];
    chrome.storage.local.set({ sessionRuns: [] });
    chrome.storage.local.remove(["benchmarkReport", "stats"]);

    // Reset all metric displays
    resetMetricDisplays();
    if (liveTime) liveTime.textContent = "";

    // Restore feed null state
    renderFeedNullState();

    transientState = null;
    applyState();
});

// --- Metric Display Helpers ---
function resetMetricDisplays() {
    Object.values(metricEls).forEach((el) => {
        if (el) {
            el.textContent = "--";
            el.className = METRIC_VAL_BASE;
        }
    });
}

function setMetricValue(el: HTMLSpanElement | null, value: string) {
    if (!el) return;
    el.textContent = value;
}

// --- Clock (drives status bar timer AND Time on Task metric cell) ---
function startClock(startTime: number) {
    recordingStartTime = startTime;
    if (clockInterval) clearInterval(clockInterval);
    clockInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const seconds = Math.floor(elapsed / 1000);
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        if (liveTime) liveTime.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
        if (metricEls.taskTime) metricEls.taskTime.textContent = formatTaskTime(elapsed);
    }, 100);
}

function stopClock() {
    if (clockInterval) {
        clearInterval(clockInterval);
        clockInterval = null;
    }
}

// --- Feed Event Handling ---
function handleFeedEvent(event: FeedEvent) {
    // Update metric summary from metricUpdates
    if (event.metricUpdates) {
        for (const [key, update] of Object.entries(event.metricUpdates) as [string, { value: string }][]) {
            setMetricValue(metricEls[key], update.value);
        }
    }

    // Remove null state placeholder if present
    const nullState = feedEl.querySelector(".feed-null");
    if (nullState) nullState.remove();

    // Build feed entry DOM node
    const entry = document.createElement("div");
    entry.className = "feed-entry";

    const tsStr = formatElapsed(event.ts);
    const dotClass = "feed-dot";

    entry.innerHTML =
        `<div class="feed-ts t-mono">${tsStr}</div>` +
        `<div class="feed-node"><div class="${dotClass}"></div></div>` +
        `<div class="feed-content">` +
        `<div class="feed-label">${escapeHtml(event.label)}</div>` +
        (event.detail ? `<div class="feed-detail">${escapeHtml(event.detail)}</div>` : "") +
        `</div>`;

    feedEl.appendChild(entry);

    // Buffer cap: remove oldest entries
    while (feedEl.children.length > FEED_MAX) {
        feedEl.removeChild(feedEl.firstChild!);
    }

    // Always scroll to bottom so the latest event is visible
    feedEl.scrollTop = feedEl.scrollHeight;
}

// --- UI State Management ---
async function updateUI(isRecording: boolean) {
    // Clear transient state — the worker has responded
    transientState = null;

    if (isRecording) {
        document.body.classList.add("recording");

        // Reset feed and metrics synchronously before any awaits (prevents race with FEED_EVENTs)
        feedEl.innerHTML = "";
        Object.values(metricEls).forEach((el) => {
            if (el) {
                el.textContent = "0";
                el.className = METRIC_VAL_BASE;
            }
        });
        if (metricEls.taskTime) metricEls.taskTime.textContent = "0s";

        // Get start time for clock (async — safe because reset is already done)
        const { recordingState } = await chrome.storage.local.get("recordingState");
        if (recordingState?.startTime) {
            startClock(recordingState.startTime);
        }
    } else {
        document.body.classList.remove("recording");
        stopClock();

        // Fetch the just-finished report and add to session
        const { benchmarkReport } = await chrome.storage.local.get("benchmarkReport");
        if (benchmarkReport) {
            sessionRuns.push(benchmarkReport);
            await chrome.storage.local.set({ sessionRuns });
            await chrome.storage.local.remove("benchmarkReport");

            // Append run-complete banner to give closure and signal next run
            const banner = document.createElement("div");
            banner.className = "feed-complete";
            banner.textContent = `Run ${sessionRuns.length} complete`;
            feedEl.appendChild(banner);
            feedEl.scrollTop = feedEl.scrollHeight;
        }
    }
    applyState();
}

// --- Helpers ---
function formatElapsed(ts: number): string {
    if (!recordingStartTime) return "00:00";
    const elapsed = ts - recordingStartTime;
    const seconds = Math.floor(Math.max(0, elapsed) / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

// --- Recovery: populate metrics from stats when panel opens mid-recording ---

/** SYNC: formatting mirrors worker.ts METRIC_FORMATS for scroll and travel */
const RECOVERY_FORMAT: Record<string, (v: number) => string> = {
    scroll: (v) => formatCompact(v),
    travel: (v) => formatCompact(v),
};

function populateMetricsFromStats(stats: LiveStats) {
    if (!stats) return;

    for (const elKey of Object.keys(metricEls)) {
        const el = metricEls[elKey];
        const raw = stats[elKey as keyof LiveStats];
        if (el && raw !== undefined && raw !== null) {
            const fmt = RECOVERY_FORMAT[elKey];
            el.textContent = fmt ? fmt(raw as number) : raw.toString();
        }
    }
}

// --- Download Handler ---

function downloadFile(content: string, filename: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename, saveAs: true }, () => {
        URL.revokeObjectURL(url);
    });
}

downloadBtn.addEventListener("click", async () => {
    if (downloadBtn.disabled || sessionRuns.length === 0) return;

    let report: BenchmarkReport;
    try {
        report = buildAveragedReport(sessionRuns);
    } catch {
        console.warn("UXBench: No valid runs to export");
        return;
    }

    const ts = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    const count = (report.metadata as any).run_count || 1;
    const format = formatSelect.value;

    if (format === "markdown") {
        const md = generateMarkdownReport(report);
        downloadFile(md, `uxbench_${ts}_AVG_${count}runs.md`, "text/markdown");
    } else {
        downloadFile(JSON.stringify(report, null, 2), `uxbench_${ts}_AVG_${count}runs.json`, "application/json");
    }
});

// --- Initialize ---
chrome.storage.local
    .get(["recordingState", "sessionRuns", "stats"])
    .then(({ recordingState, sessionRuns: storedRuns, stats }) => {
        sessionRuns = storedRuns || [];

        if (recordingState?.isRecording) {
            document.body.classList.add("recording");
            if (recordingState.startTime) {
                startClock(recordingState.startTime);
            }
            // Recovery: populate metrics from stored stats
            if (stats) {
                populateMetricsFromStats(stats);
            }
            // Clear feed empty state
            feedEl.innerHTML = "";
        } else {
            document.body.classList.remove("recording");
            // Panel reopened — render appropriate null state (fresh or runs-exist)
            renderFeedNullState();
        }
        applyState();
    });

// --- Message Listener ---
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "RECORDING_STARTED") updateUI(true);
    if (message.type === "RECORDING_STOPPED") updateUI(false);
    if (message.type === "FEED_EVENT") handleFeedEvent(message.event);
});
