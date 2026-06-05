/// <reference types="chrome"/>

import { createBrowserInstrumentation, type BrowserInstrumentation } from "../browser/instrumentation";
import { MetricEngine, type MetricEvent, type TaskHandle, type TaskPayload, type TaskSnapshot } from "../core";
import { BRAND_ORANGE, NOOP } from "./shared";

const Z_TOP = 2147483647;
const CURSOR_SNAPSHOT_THROTTLE_MS = 500;

const OVERLAY_CSS = `
    position: fixed; bottom: 20px; right: 20px;
    background: ${BRAND_ORANGE}; color: #EEEEEE;
    padding: 8px 12px; border-radius: 4px;
    z-index: ${Z_TOP};
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    pointer-events: none;
`;

interface HarnessFeedEvent {
    type: string;
    label: string;
    detail?: string;
}

class HarnessCollector {
    private engine: MetricEngine | null = null;
    private instrumentation: BrowserInstrumentation | null = null;
    private task: TaskHandle | null = null;
    private lastCursorSnapshotAt = 0;

    constructor() {
        this.initListeners();
    }

    private initListeners() {
        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            if (message.type === "RECORDING_STARTED") {
                this.start();
            } else if (message.type === "RECORDING_STOPPED") {
                this.stop("cancelled").catch(NOOP);
            } else if (message.type === "FLUSH_AND_STOP_RECORDING") {
                this.stop("completed")
                    .then((payload) => sendResponse({ ok: true, payload }))
                    .catch((err) => sendResponse({ ok: false, error: String(err) }));
                return true;
            }
        });

        chrome.storage.local.get("recordingState").then(({ recordingState }) => {
            if (recordingState?.isRecording) this.start();
        });
    }

    private start() {
        if (this.engine || this.instrumentation || this.task) return;

        this.engine = new MetricEngine({
            app: "UX Bench Harness",
            source: "chrome-extension",
            sessionId: `harness-${Date.now().toString(36)}`,
        });
        this.task = this.engine.startTask("harness-recording", {
            dimensions: { url: location.href },
        });
        this.instrumentation = createBrowserInstrumentation({
            emit: (event) => this.handleMetricEvent(event),
        });
        this.instrumentation.start();
        this.addOverlay();
    }

    private async stop(status: "completed" | "cancelled"): Promise<TaskPayload | null> {
        if (!this.engine || !this.instrumentation || !this.task) return null;

        this.instrumentation.destroy();
        const payload = this.task.end({ status });
        this.engine = null;
        this.instrumentation = null;
        this.task = null;
        this.lastCursorSnapshotAt = 0;
        this.removeOverlay();
        return payload;
    }

    private handleMetricEvent(event: MetricEvent) {
        if (!this.engine || !this.task) return;
        this.engine.ingest(event);

        if (event.type === "cursor") {
            const now = performance.now();
            if (now - this.lastCursorSnapshotAt < CURSOR_SNAPSHOT_THROTTLE_MS) return;
            this.lastCursorSnapshotAt = now;
        }

        const snapshot = this.task.snapshot();
        chrome.runtime
            .sendMessage({
                type: "HARNESS_SNAPSHOT",
                snapshot,
                feed: this.buildFeedEvent(event, snapshot),
            })
            .catch(NOOP);
    }

    private buildFeedEvent(event: MetricEvent, snapshot: TaskSnapshot): HarnessFeedEvent {
        switch (event.type) {
            case "click": {
                const id = event.target.id ? `#${event.target.id}` : "";
                const detail =
                    event.classification === "standard" ? `${event.target.tagName}${id}` : event.classification;
                return {
                    type: "click",
                    label: `CLICK (${snapshot.metrics.clicks.total})`,
                    detail,
                };
            }
            case "scroll":
                return {
                    type: "scroll",
                    label: `SCROLL +${Math.round(event.delta_px)}px`,
                };
            case "input":
                return {
                    type: "keyboard",
                    label: event.mode === "keyboard" ? "KEYBOARD" : "MOUSE",
                    detail: event.shortcut ? "shortcut" : undefined,
                };
            case "cursor":
                return {
                    type: "cursor",
                    label: `TRAVEL +${Math.round(event.delta_px)}px`,
                };
        }
    }

    private addOverlay() {
        const div = document.createElement("div");
        div.id = "uxbench-overlay";
        div.style.cssText = OVERLAY_CSS;
        div.textContent = "REC \u25cf";
        document.body.appendChild(div);
    }

    private removeOverlay() {
        document.getElementById("uxbench-overlay")?.remove();
    }
}

if (!(window as any).__uxbench_loaded) {
    (window as any).__uxbench_loaded = true;
    new HarnessCollector();
}
