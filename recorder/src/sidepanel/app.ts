/// <reference types="chrome"/>

// ========================================================
// Local types (MV3: cannot share imports with service worker)
// SYNC: these types mirror worker.ts — update both when changing the metric schema.
// ========================================================

interface DetailEntry { element: string; reason: string; }
interface IdleGap { gap_ms: number; after_action: string; before_action: string; }
interface FittsEntry { element: string; id: number; distance_px: number; target_size: string; }
interface DepthPathEntry { direction: string; layer: string; }
interface ActionLogEntry { type: string; timestamp: number; target: string; text: string; classification: string; }

/** Shape of a completed benchmark report stored per-run */
interface BenchmarkReport {
    schema_version: string;
    source: string;
    metadata: Record<string, unknown>;
    metrics: {
        click_count: {
            total: number; productive: number; ceremonial: number; wasted: number;
            ceremonial_details: DetailEntry[]; wasted_details: DetailEntry[];
        };
        time_on_task: {
            total_ms: number; application_wait_ms: number; idle_gaps: IdleGap[];
            idle_ms?: number; active_ms?: number; longest_idle_ms?: number; longest_idle_after?: string;
        };
        fitts: {
            formula: string; cumulative_id: number; average_id: number;
            max_id: number; max_id_element: string; max_id_distance_px: number;
            max_id_target_size: string; top_3_hardest: FittsEntry[];
        };
        information_density: {
            method: string; average_content_ratio: number;
            min_content_ratio: number; max_content_ratio: number;
            min_content_context?: string; max_content_context?: string;
        };
        context_switches: {
            total: number; ratio: number;
            longest_keyboard_streak?: number; longest_mouse_streak?: number;
        };
        shortcut_coverage: {
            shortcuts_used: number;
        };
        typing_ratio: {
            free_text_inputs: number; constrained_inputs: number;
            ratio: number; free_text_fields: string[];
        };
        navigation_depth: {
            max_depth: number; total_depth_changes: number;
            deepest_moment?: string; depth_path: DepthPathEntry[];
        };
        scanning_distance: {
            method: string; cumulative_px: number;
            average_px: number; max_single_px: number;
            max_single_from?: string; max_single_to?: string;
        };
        scroll_distance: {
            total_px: number; page_scroll_px?: number; container_scroll_px?: number;
            total_horizontal_px?: number; scroll_events?: number; heaviest_container?: string;
        };
        composite_score: number;
    };
    action_log: ActionLogEntry[];
}

/** FEED_EVENT pushed from the worker for real-time display */
interface FeedEvent {
    id: number; ts: number; type: string;
    label: string; detail?: string;
    metricUpdates?: Record<string, { value: string }>;
}

/** Live stats snapshot stored by the worker for recovery */
interface LiveStats {
    clicks: number; depth: number; scroll: number; switches: number;
    composite: number; fitts: number; density: number;
    shortcuts: number; typing: number; scanAvg: number; waitMs: number;
}

// --- Element References ---
const actionBtn = document.getElementById('actionBtn') as HTMLButtonElement;
const downloadBtn = document.getElementById('downloadBtn') as HTMLButtonElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const resSelect = document.getElementById('resSelect') as HTMLSelectElement;
const liveTime = document.getElementById('liveTime') as HTMLSpanElement;
const runCount = document.getElementById('runCount') as HTMLSpanElement;
const feedEl = document.getElementById('feed') as HTMLDivElement;

// Metric display elements (all 10 + composite)
const metricEls: Record<string, HTMLSpanElement | null> = {
    clicks: document.getElementById('mClicks'),
    depth: document.getElementById('mDepth'),
    scroll: document.getElementById('mScroll'),
    fitts: document.getElementById('mFitts'),
    switches: document.getElementById('mSwitches'),
    density: document.getElementById('mDensity'),
    shortcuts: document.getElementById('mShortcuts'),
    typing: document.getElementById('mTyping'),
    scanAvg: document.getElementById('mScan'),
    wait: document.getElementById('mWait'),
    cost: document.getElementById('mCost'),
};

// Base CSS class for all metric value elements (preserves t-mono utility)
const METRIC_VAL_BASE = 'metric-val t-mono';

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

type PanelState = 'COLD_START' | 'READY' | 'STARTING' | 'RECORDING' | 'STOPPING' | 'HAS_RUNS';

function deriveState(): PanelState {
    const isRecording = document.body.classList.contains('recording');
    const viewportSelected = resSelect.value !== '';
    const hasRuns = sessionRuns.length > 0;

    if (isRecording) return 'RECORDING';
    if (hasRuns) return 'HAS_RUNS';
    if (viewportSelected) return 'READY';
    return 'COLD_START';
}

// Transient states (STARTING / STOPPING) are set explicitly and
// override deriveState() until the worker responds.
let transientState: 'STARTING' | 'STOPPING' | null = null;

function currentState(): PanelState {
    return transientState ?? deriveState();
}

function applyState() {
    const state = currentState();

    // --- Run counter (always visible) ---
    if (runCount) runCount.textContent = `RUNS: ${sessionRuns.length}`;

    // --- Action button ---
    switch (state) {
        case 'COLD_START':
            actionBtn.textContent = 'Start';
            actionBtn.disabled = true;
            break;
        case 'READY':
            actionBtn.textContent = 'Start';
            actionBtn.disabled = false;
            break;
        case 'STARTING':
            actionBtn.textContent = 'Starting\u2026';
            actionBtn.disabled = true;
            break;
        case 'RECORDING':
            actionBtn.textContent = 'Stop';
            actionBtn.disabled = false;
            break;
        case 'STOPPING':
            actionBtn.textContent = 'Stopping\u2026';
            actionBtn.disabled = true;
            break;
        case 'HAS_RUNS':
            actionBtn.textContent = 'Start';
            actionBtn.disabled = resSelect.value === '';
            break;
    }

    // --- Download: need runs and not be recording/transitioning ---
    downloadBtn.disabled = (state !== 'HAS_RUNS');

    // --- Clear: need runs and not be recording/transitioning ---
    clearBtn.disabled = (state !== 'HAS_RUNS');

    // --- Viewport select: locked while recording or transitioning ---
    resSelect.disabled = (state === 'RECORDING' || state === 'STARTING' || state === 'STOPPING');
}


// --- Resolution Logic ---
resSelect.addEventListener('change', async (e) => {
    applyState();

    const target = (e.target as HTMLSelectElement).value;
    if (!target) return;

    const [wStr, hStr] = target.split('x');
    const targetW = parseInt(wStr);
    const targetH = parseInt(hStr);

    try {
        const windowObj = await chrome.windows.getCurrent();
        const [tab] = await chrome.tabs.query({ active: true, windowId: windowObj.id });

        if (!tab?.id || !windowObj.id) return;

        // chrome.scripting.executeScript cannot run on chrome:// or edge:// pages
        if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://'))) {
            console.warn('UXBench: Cannot resize viewport on a browser internal page. Navigate to a website first.');
            return;
        }

        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => ({ w: window.innerWidth, h: window.innerHeight })
        });

        const viewport = results[0].result;
        if (!viewport) return;

        const deltaW = targetW - viewport.w;
        const deltaH = targetH - viewport.h;

        await chrome.windows.update(windowObj.id, {
            width: (windowObj.width || 0) + deltaW,
            height: (windowObj.height || 0) + deltaH,
            state: 'normal'
        });
    } catch (err) {
        console.warn('UXBench: Could not resize viewport —', (err as Error).message);
    }
});

// --- Action (Start/Stop) Logic ---
actionBtn.addEventListener('click', () => {
    if (actionBtn.disabled) return;

    const state = currentState();

    if (state === 'RECORDING') {
        transientState = 'STOPPING';
        applyState();
        chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
    } else if (state === 'READY' || state === 'HAS_RUNS') {
        transientState = 'STARTING';
        applyState();
        chrome.runtime.sendMessage({ type: 'START_RECORDING' });
    }
});

// --- Clear Logic ---
clearBtn.addEventListener('click', () => {
    sessionRuns = [];
    chrome.storage.local.set({ sessionRuns: [] });
    chrome.storage.local.remove(['benchmarkReport', 'stats']);

    // Reset all metric displays
    resetMetricDisplays();
    if (liveTime) liveTime.textContent = '00:00';

    // Clear activity feed
    feedEl.innerHTML = '<div class="feed-empty">Waiting for recording\u2026</div>';

    transientState = null;
    applyState();
});

// --- Metric Display Helpers ---
function resetMetricDisplays() {
    Object.values(metricEls).forEach(el => {
        if (el) {
            el.textContent = '--';
            el.className = METRIC_VAL_BASE;
        }
    });
}

function setMetricValue(el: HTMLSpanElement | null, value: string) {
    if (!el) return;
    el.textContent = value;
}

// --- Clock (elapsed time only) ---
function startClock(startTime: number) {
    recordingStartTime = startTime;
    if (clockInterval) clearInterval(clockInterval);
    clockInterval = setInterval(() => {
        if (liveTime) {
            const elapsed = Date.now() - startTime;
            const seconds = Math.floor(elapsed / 1000);
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            liveTime.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }
    }, 1000);
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

    // Remove empty state placeholder if present
    const empty = feedEl.querySelector('.feed-empty');
    if (empty) empty.remove();

    // Build feed entry DOM node
    const entry = document.createElement('div');
    entry.className = 'feed-entry';

    const tsStr = formatElapsed(event.ts);
    const dotClass = 'feed-dot';

    entry.innerHTML =
        `<div class="feed-ts t-mono">${tsStr}</div>` +
        `<div class="feed-node"><div class="${dotClass}"></div></div>` +
        `<div class="feed-content">` +
        `<div class="feed-label">${escapeHtml(event.label)}</div>` +
        (event.detail ? `<div class="feed-detail">${escapeHtml(event.detail)}</div>` : '') +
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
        document.body.classList.add('recording');

        // Reset feed and metrics synchronously before any awaits (prevents race with FEED_EVENTs)
        feedEl.innerHTML = '';
        Object.values(metricEls).forEach(el => { if (el) { el.textContent = '0'; el.className = METRIC_VAL_BASE; } });
        if (metricEls.depth) metricEls.depth.textContent = '1'; if (metricEls.density) metricEls.density.textContent = '--'; if (metricEls.wait) metricEls.wait.textContent = '0ms';

        // Get start time for clock (async — safe because reset is already done)
        const { recordingState } = await chrome.storage.local.get('recordingState');
        if (recordingState?.startTime) {
            startClock(recordingState.startTime);
        }
    } else {
        document.body.classList.remove('recording');
        stopClock();

        // Fetch the just-finished report and add to session
        const { benchmarkReport } = await chrome.storage.local.get('benchmarkReport');
        if (benchmarkReport) {
            sessionRuns.push(benchmarkReport);
            await chrome.storage.local.set({ sessionRuns });
            await chrome.storage.local.remove('benchmarkReport');
        }
    }
    applyState();
}

// --- Helpers ---
function formatElapsed(ts: number): string {
    if (!recordingStartTime) return '00:00';
    const elapsed = ts - recordingStartTime;
    const seconds = Math.floor(Math.max(0, elapsed) / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- Recovery: populate metrics from stats when panel opens mid-recording ---

/** Maps metric element keys to stats keys where names differ */
const STATS_RENAMES: Record<string, keyof LiveStats> = { wait: 'waitMs', cost: 'composite' };

/** SYNC: formatting mirrors worker.ts METRIC_FORMATS for density, wait, and scroll */
const RECOVERY_FORMAT: Record<string, (v: number) => string> = {
    density: v => v > 0 ? Math.round(v * 100) + '%' : '--',
    wait:    v => v >= 1000 ? round2(v / 1000) + 's' : v + 'ms',
    scroll:  v => formatCompact(v),
};

function populateMetricsFromStats(stats: LiveStats) {
    if (!stats) return;

    for (const elKey of Object.keys(metricEls)) {
        const el = metricEls[elKey];
        const statsKey = STATS_RENAMES[elKey] || elKey;
        const raw = stats[statsKey as keyof LiveStats];
        if (el && raw !== undefined && raw !== null) {
            const fmt = RECOVERY_FORMAT[elKey];
            el.textContent = fmt ? fmt(raw as number) : raw.toString();
        }
    }
}

// SYNC: round2 and formatCompact are also defined in worker.ts — cannot share imports across MV3 execution contexts
const round2 = (v: number) => Math.round(v * 100) / 100;

function formatCompact(n: number): string {
    if (n >= 1000) return round2(n / 1000) + 'k';
    return n.toString();
}

// --- Download Handler (Data-driven averaging) ---

// Each averaging field: metric path, how to read from a run, how to round the average
interface AvgField {
    path: string;        // dot-notation path into metrics (e.g., 'click_count.total')
    round: (v: number) => number;
    defaultVal?: number; // fallback if field is missing (default: 0)
}

const AVG_FIELDS: AvgField[] = [
    { path: 'click_count.total',                         round: Math.round },
    { path: 'click_count.productive',                    round: Math.round },
    { path: 'click_count.ceremonial',                    round: Math.round },
    { path: 'click_count.wasted',                        round: Math.round },
    { path: 'time_on_task.total_ms',                     round: Math.round },
    { path: 'navigation_depth.max_depth',                round: Math.round, defaultVal: 1 },
    { path: 'composite_score',                           round: round2 },
    { path: 'fitts.cumulative_id',                       round: round2 },
    { path: 'fitts.average_id',                          round: round2 },
    { path: 'fitts.max_id',                              round: round2 },
    { path: 'scanning_distance.cumulative_px',           round: Math.round },
    { path: 'scanning_distance.average_px',              round: Math.round },
    { path: 'scanning_distance.max_single_px',           round: Math.round },
    { path: 'scroll_distance.total_px',                  round: Math.round },
    { path: 'scroll_distance.page_scroll_px',            round: Math.round },
    { path: 'scroll_distance.container_scroll_px',       round: Math.round },
    { path: 'scroll_distance.scroll_events',             round: Math.round },
    { path: 'context_switches.total',                    round: Math.round },
    { path: 'context_switches.ratio',                    round: round2 },
    { path: 'shortcut_coverage.shortcuts_used',          round: Math.round },
    { path: 'typing_ratio.free_text_inputs',             round: Math.round },
    { path: 'typing_ratio.constrained_inputs',           round: Math.round },
    { path: 'typing_ratio.ratio',                        round: round2 },
    { path: 'information_density.average_content_ratio',  round: round2 },
    { path: 'information_density.min_content_ratio',      round: round2 },
    { path: 'information_density.max_content_ratio',      round: round2 },
];

function getPath(obj: any, path: string): number {
    const parts = path.split('.');
    let cur = obj;
    for (const p of parts) {
        if (cur == null) return 0;
        cur = cur[p];
    }
    return typeof cur === 'number' ? cur : 0;
}

function setPath(obj: any, path: string, value: number) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] == null) cur[parts[i]] = {};
        cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
}

downloadBtn.addEventListener('click', async () => {
    if (downloadBtn.disabled || sessionRuns.length === 0) return;

    const validRuns = sessionRuns.filter(run =>
        run && run.metrics && run.metrics.click_count &&
        typeof run.metrics.click_count.total === 'number'
    );

    if (validRuns.length === 0) {
        console.warn('UXBench: No valid runs to average');
        return;
    }

    const baseReport = JSON.parse(JSON.stringify(validRuns[validRuns.length - 1]));
    const count = validRuns.length;

    // Data-driven sum + average for all numeric fields
    const sums = new Map<string, number>();
    for (const field of AVG_FIELDS) sums.set(field.path, 0);

    validRuns.forEach(run => {
        for (const field of AVG_FIELDS) {
            // composite_score is top-level, all others are under metrics
            const source = field.path === 'composite_score' ? run : run.metrics;
            sums.set(field.path, (sums.get(field.path) || 0) + (getPath(source, field.path) || field.defaultVal || 0));
        }
    });

    for (const field of AVG_FIELDS) {
        const target = field.path === 'composite_score' ? baseReport : baseReport.metrics;
        setPath(target, field.path, field.round((sums.get(field.path) || 0) / count));
    }

    // Merge non-numeric fields across runs
    const allHardest: FittsEntry[] = [];
    validRuns.forEach(run => {
        if (run.metrics?.fitts?.top_3_hardest) {
            allHardest.push(...run.metrics.fitts.top_3_hardest);
        }
    });
    allHardest.sort((a, b) => b.id - a.id);
    baseReport.metrics.fitts.top_3_hardest = allHardest.slice(0, 3);

    const allFields = new Set<string>();
    validRuns.forEach(run => {
        (run.metrics?.typing_ratio?.free_text_fields || []).forEach((f: string) => allFields.add(f));
    });
    baseReport.metrics.typing_ratio.free_text_fields = [...allFields];

    let bestMaxIdRun = validRuns[0];
    validRuns.forEach(run => {
        if ((run.metrics?.fitts?.max_id || 0) > (bestMaxIdRun.metrics?.fitts?.max_id || 0)) {
            bestMaxIdRun = run;
        }
    });
    baseReport.metrics.fitts.max_id_element = bestMaxIdRun.metrics?.fitts?.max_id_element || '';

    // Metadata
    baseReport.metadata.run_count = count;
    baseReport.metadata.averaged = true;

    const filename = `uxbench_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}_AVG_${count}runs.json`;
    const blob = new Blob([JSON.stringify(baseReport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
});

// --- Initialize ---
chrome.storage.local.get(['recordingState', 'sessionRuns', 'stats']).then(({ recordingState, sessionRuns: storedRuns, stats }) => {
    sessionRuns = storedRuns || [];

    if (recordingState?.isRecording) {
        document.body.classList.add('recording');
        if (recordingState.startTime) {
            startClock(recordingState.startTime);
        }
        // Recovery: populate metrics from stored stats
        if (stats) {
            populateMetricsFromStats(stats);
        }
        // Clear feed empty state
        feedEl.innerHTML = '';
    } else {
        document.body.classList.remove('recording');
    }
    applyState();
});

// --- Message Listener ---
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'RECORDING_STARTED') updateUI(true);
    if (message.type === 'RECORDING_STOPPED') updateUI(false);
    if (message.type === 'FEED_EVENT') handleFeedEvent(message.event);
});
