/// <reference types="chrome"/>

// ========================================================
// Types
// ========================================================

interface RecordingState {
    isRecording: boolean;
    startTime?: number;
    lastClickPosition?: { x: number; y: number } | null;
    lastClickTarget?: string | null;
    lastActionTime?: number | null;
    lastActionLabel?: string | null;
    currentRecording?: BenchmarkReport;
}

interface BenchmarkReport {
    schema_version: string;
    source: string;
    metadata: Record<string, any>;
    metrics: Metrics;
    action_log: ActionLogEntry[];
}

interface Metrics {
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
}

interface DetailEntry { element: string; reason: string; }
interface IdleGap { gap_ms: number; after_action: string; before_action: string; _emitted?: boolean; }
interface FittsEntry { element: string; id: number; distance_px: number; target_size: string; }
interface DepthPathEntry { direction: string; layer: string; }
interface ActionLogEntry { type: string; timestamp: number; target: string; text: string; classification: string; }

interface ClickPayload {
    type: 'click'; timestamp: number; x: number; y: number;
    classification?: string; classificationReason?: string;
    target: { tagName: string; id?: string; innerText?: string; rect: { width: number; height: number } };
}
interface ScrollPayload {
    type: 'scroll_update'; total_px: number; page_scroll_px: number;
    container_scroll_px: number; total_horizontal_px?: number;
    scroll_events: number; heaviest_container?: string;
}
interface KeyboardPayload {
    type: 'keyboard_update';
    context_switches: { total: number; ratio: number; longest_keyboard_streak: number; longest_mouse_streak: number };
    shortcut_coverage: { shortcuts_used: number };
    typing_ratio: { free_text_inputs: number; constrained_inputs: number; ratio: number; free_text_fields: string[] };
}
interface DepthPayload {
    type: 'depth_update';
    navigation_depth: { max_depth: number; total_depth_changes: number; deepest_moment?: string; depth_path: DepthPathEntry[] };
}
interface DensityPayload {
    type: 'density_update';
    information_density: {
        average_content_ratio: number; min_content_ratio: number; max_content_ratio: number;
        min_content_context?: string; max_content_context?: string;
    };
}
interface WaitPayload { type: 'wait_update'; application_wait_ms?: number; }

type EventPayload = ClickPayload | ScrollPayload | KeyboardPayload | DepthPayload | DensityPayload | WaitPayload;

interface FeedEvent {
    id: number; ts: number; type: string;
    label: string; detail?: string;
    metricUpdates: Record<string, { value: string }>;
}

// ========================================================
// Metric Formatting — display format for each metric key
// ========================================================

interface MetricFormatDef {
    format: (v: number) => string;
}

/** Intentional no-op for Chrome messaging .catch() — receiver may not exist (e.g., no active tab, panel closed).
 *  SYNC: content scripts share NOOP via content/shared.ts; worker keeps its own copy (separate MV3 execution context). */
const NOOP = () => {};

// Named constants for magic numbers used in event processing
const IDLE_GAP_MS = 3000;
const ACTION_LOG_MAX = 500;
const SCROLL_FEED_THROTTLE_MS = 500;

/** Format functions for each metric key — used by buildMetricSnapshot for live display values */
const METRIC_FORMATS: Record<string, MetricFormatDef> = {
    clicks:    { format: v => v.toString() },
    depth:     { format: v => v.toString() },
    scroll:    { format: v => formatCompact(Math.round(v)) },
    fitts:     { format: v => round2(v).toString() },
    switches:  { format: v => v.toString() },
    density:   { format: v => v > 0 ? Math.round(v * 100) + '%' : '--' },
    shortcuts: { format: v => v.toString() },
    typing:    { format: v => round2(v).toString() },
    scanAvg:   { format: v => Math.round(v).toString() },
    wait:      { format: v => v >= 1000 ? round2(v / 1000) + 's' : v + 'ms' },
    cost:      { format: v => v.toString() },
};


// ========================================================
// Shared utilities
// ========================================================

// SYNC: round2 and formatCompact are also defined in app.ts — cannot share imports across MV3 execution contexts
const round2 = (v: number) => Math.round(v * 100) / 100;

function formatCompact(n: number): string {
    if (n >= 1000) return round2(n / 1000) + 'k';
    return n.toString();
}

/**
 * Composite score weights. Each coefficient normalizes its metric's contribution
 * so that a score of ~25 represents moderate UX friction.
 */
const COMPOSITE_WEIGHTS = {
    waitSec: 1.0,     // 1 point per second of forced waiting
    depth: 2.0,       // navigation layers penalized heavily (modal-in-modal)
    switches: 1.5,    // each input mode switch = moderate friction
    fitts: 1.0,       // cumulative Fitts ID bits, direct pass-through
    scrollPx: 0.005,  // 200px scroll ≈ 1 point
} as const;

function computeComposite(m: Metrics): number {
    return ((m.time_on_task.application_wait_ms || 0) / 1000 * COMPOSITE_WEIGHTS.waitSec) +
        (m.navigation_depth.max_depth * COMPOSITE_WEIGHTS.depth) +
        (m.context_switches.total * COMPOSITE_WEIGHTS.switches) +
        (m.fitts.cumulative_id * COMPOSITE_WEIGHTS.fitts) +
        (m.scroll_distance.total_px * COMPOSITE_WEIGHTS.scrollPx);
}

/** Read raw metric value for a given metric key */
function readMetric(m: Metrics, key: string): number {
    switch (key) {
        case 'clicks':    return m.click_count.total;
        case 'depth':     return m.navigation_depth.max_depth;
        case 'scroll':    return m.scroll_distance.total_px;
        case 'fitts':     return m.fitts.average_id;
        case 'switches':  return m.context_switches.total;
        case 'density':   return m.information_density.average_content_ratio;
        case 'shortcuts': return m.shortcut_coverage.shortcuts_used;
        case 'typing':    return m.typing_ratio.ratio;
        case 'scanAvg':   return m.scanning_distance.average_px;
        case 'wait':      return m.time_on_task.application_wait_ms || 0;
        case 'cost':      return 0; // handled separately
        default:          return 0;
    }
}

/** Build metric snapshot for all metrics (used by FEED_EVENT) */
function buildMetricSnapshot(m: Metrics, composite: number): Record<string, { value: string }> {
    const snapshot: Record<string, { value: string }> = {};
    for (const key of Object.keys(METRIC_FORMATS)) {
        if (key === 'cost') {
            snapshot[key] = { value: composite.toString() };
        } else {
            const raw = readMetric(m, key);
            snapshot[key] = { value: METRIC_FORMATS[key].format(raw) };
        }
    }
    return snapshot;
}

// ========================================================
// State
// ========================================================

const initialState: RecordingState = { isRecording: false };
let isTransitioning = false;

// Feed event state — reset on each startRecording()
let feedCounter = 0;
let lastScrollTotal = 0;
let lastScrollFeedTime = 0;

// ========================================================
// Lifecycle: Install
// ========================================================

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ recordingState: initialState });
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// ========================================================
// Lifecycle: Keyboard shortcuts
// ========================================================

chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'toggle-recording') {
        const { recordingState } = await chrome.storage.local.get('recordingState');
        if (recordingState?.isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    }
});

// ========================================================
// Lifecycle: Message handling
// ========================================================

chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
    if (message.type === 'START_RECORDING' && !isTransitioning) {
        isTransitioning = true;
        startRecording().finally(() => { isTransitioning = false; });
    } else if (message.type === 'STOP_RECORDING' && !isTransitioning) {
        isTransitioning = true;
        stopRecording().finally(() => { isTransitioning = false; });
    } else if (message.type === 'EVENT_CAPTURED') {
        handleEvent(message.payload);
    }
});

// ========================================================
// Recording lifecycle
// ========================================================

async function startRecording() {
    console.log('UXBench: Starting recording...');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const now = Date.now();

    const state: RecordingState = {
        isRecording: true,
        startTime: now,
        lastClickPosition: null,
        lastClickTarget: null,
        lastActionTime: now,
        lastActionLabel: null,
        currentRecording: {
            schema_version: '1.0',
            source: 'chrome-extension',
            metadata: {
                recording_name: '',
                product: '',
                task: '',
                url: tab?.url || '',
                urls_visited: tab?.url ? [tab.url] : [],
                timestamp: new Date(now).toISOString(),
                duration_ms: 0,
                browser: navigator.userAgent,
                source_version: '1.0.0',
                operator: 'human',
                navigation_count: 0,
                navigation_gap_ms: 0
            },
            metrics: {
                click_count: {
                    total: 0, productive: 0, ceremonial: 0, wasted: 0,
                    ceremonial_details: [], wasted_details: []
                },
                time_on_task: {
                    total_ms: 0, application_wait_ms: 0, idle_gaps: []
                },
                fitts: {
                    formula: 'shannon', cumulative_id: 0, average_id: 0,
                    max_id: 0, max_id_element: '', max_id_distance_px: 0,
                    max_id_target_size: '', top_3_hardest: []
                },
                information_density: {
                    method: 'dom-coverage', average_content_ratio: 0,
                    min_content_ratio: 0, max_content_ratio: 0
                },
                context_switches: { total: 0, ratio: 0 },
                shortcut_coverage: { shortcuts_used: 0 },
                typing_ratio: {
                    free_text_inputs: 0, constrained_inputs: 0,
                    ratio: 0, free_text_fields: []
                },
                navigation_depth: {
                    max_depth: 1, total_depth_changes: 0, depth_path: []
                },
                scanning_distance: {
                    method: 'euclidean', cumulative_px: 0,
                    average_px: 0, max_single_px: 0
                },
                scroll_distance: { total_px: 0 },
                composite_score: 0
            },
            action_log: []
        }
    };

    // Reset feed state
    feedCounter = 0;
    lastScrollTotal = 0;
    lastScrollFeedTime = 0;

    // Clear previous stats and report, write new state
    await chrome.storage.local.set({
        recordingState: state,
        stats: null,
        benchmarkReport: null
    });

    // Notify content script
    if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'RECORDING_STARTED' }).catch(NOOP);
    }

    // Badge (only if action is configured in manifest)
    if (chrome.action) {
        chrome.action.setBadgeText({ text: 'REC' }).catch(NOOP);
        chrome.action.setBadgeBackgroundColor({ color: '#EE6019' }).catch(NOOP);
    }

    // Notify side panel and other extension pages
    chrome.runtime.sendMessage({ type: 'RECORDING_STARTED' }).catch(NOOP);
}

async function stopRecording() {
    console.log('UXBench: Stopping recording...');
    const { recordingState } = await chrome.storage.local.get('recordingState');
    if (!recordingState?.isRecording) return;

    // Calculate duration
    const duration = Date.now() - (recordingState.startTime || Date.now());

    // Build the final benchmark report
    const report = recordingState.currentRecording as BenchmarkReport | undefined;
    if (report) {
        report.metadata.duration_ms = duration;
        report.metrics.time_on_task.total_ms = duration;

        // Derive idle/active time from idle gaps
        const gaps = report.metrics.time_on_task.idle_gaps || [];
        const totalGapMs = gaps.reduce((sum: number, g: IdleGap) => sum + g.gap_ms, 0);
        report.metrics.time_on_task.idle_ms = totalGapMs;
        report.metrics.time_on_task.active_ms = duration - totalGapMs;
        if (gaps.length > 0) {
            const longestGap = gaps.reduce((max: IdleGap, g: IdleGap) => g.gap_ms > max.gap_ms ? g : max, gaps[0]);
            report.metrics.time_on_task.longest_idle_ms = longestGap.gap_ms;
            report.metrics.time_on_task.longest_idle_after = longestGap.after_action;
        }

        // Composite score (single source: computeComposite)
        report.metrics.composite_score = computeComposite(report.metrics);
    }

    // Mark recording as stopped
    const finalState: RecordingState = { isRecording: false };

    // CRITICAL: Write report to storage BEFORE sending messages.
    // The side panel reads benchmarkReport after receiving RECORDING_STOPPED.
    await chrome.storage.local.set({
        recordingState: finalState,
        benchmarkReport: report || null,
        stats: null
    });

    // Notify content script
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'RECORDING_STOPPED' }).catch(NOOP);
    }

    // Clear badge (only if action is configured in manifest)
    if (chrome.action) {
        chrome.action.setBadgeText({ text: '' }).catch(NOOP);
    }

    // Notify side panel and other extension pages
    chrome.runtime.sendMessage({ type: 'RECORDING_STOPPED' }).catch(NOOP);
}

// ========================================================
// Event handling — serialization queue
// ========================================================

let eventQueue: Promise<void> = Promise.resolve();

function handleEvent(payload: EventPayload) {
    eventQueue = eventQueue.then(() => handleEventInternal(payload)).catch(e => console.error('UXBench event error:', e));
}

// ========================================================
// Event handling — per-type processors (R2: SRP)
// ========================================================

function detectIdleGap(recording: BenchmarkReport, payload: EventPayload, recordingState: RecordingState, now: number) {
    if (recordingState.lastActionTime) {
        const gap = now - recordingState.lastActionTime;
        if (gap > IDLE_GAP_MS) {
            const actionLabel = payload.type === 'click'
                ? ((payload as ClickPayload).target?.innerText?.substring(0, 40) || (payload as ClickPayload).target?.tagName || 'click')
                : payload.type;
            recording.metrics.time_on_task.idle_gaps.push({
                gap_ms: gap,
                after_action: recordingState.lastActionLabel || 'start',
                before_action: actionLabel
            });
        }
    }
    recordingState.lastActionTime = now;
}

/** Classify click and update click_count buckets */
function classifyAndCount(m: Metrics, payload: ClickPayload) {
    m.click_count.total += 1;
    const elLabel = payload.target.tagName + (payload.target.id ? '#' + payload.target.id : '');

    if (payload.classification === 'wasted') {
        m.click_count.wasted += 1;
        if (payload.classificationReason) {
            m.click_count.wasted_details.push({ element: elLabel, reason: payload.classificationReason });
        }
    } else if (payload.classification === 'ceremonial') {
        m.click_count.ceremonial += 1;
        if (payload.classificationReason) {
            m.click_count.ceremonial_details.push({ element: elLabel, reason: payload.classificationReason });
        }
    } else {
        m.click_count.productive += 1;
    }
}

/** Compute scanning distance + Fitts ID between consecutive clicks, update averages */
function computeFittsAndScanning(m: Metrics, payload: ClickPayload, clickTarget: string, recordingState: RecordingState) {
    if (recordingState.lastClickPosition) {
        const dx = payload.x - recordingState.lastClickPosition.x;
        const dy = payload.y - recordingState.lastClickPosition.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        m.scanning_distance.cumulative_px += distance;
        if (distance > m.scanning_distance.max_single_px) {
            m.scanning_distance.max_single_px = distance;
            m.scanning_distance.max_single_from = recordingState.lastClickTarget || 'unknown';
            m.scanning_distance.max_single_to = clickTarget;
        }

        // Fitts's Law: Shannon formulation with Welford directional target width
        const rect = payload.target.rect;
        const angle = Math.atan2(Math.abs(dy), Math.abs(dx));
        const targetWidth = rect.width * Math.abs(Math.cos(angle)) + rect.height * Math.abs(Math.sin(angle));
        if (targetWidth > 0 && distance > 0) {
            const id = Math.log2(distance / targetWidth + 1);
            m.fitts.cumulative_id += id;
            if (id > m.fitts.max_id) {
                m.fitts.max_id = id;
                m.fitts.max_id_element = clickTarget;
                m.fitts.max_id_distance_px = distance;
                m.fitts.max_id_target_size = `${Math.round(rect.width)}x${Math.round(rect.height)}px`;
            }

            // Maintain top 3 hardest targets
            m.fitts.top_3_hardest.push({
                element: clickTarget, id, distance_px: distance,
                target_size: `${Math.round(rect.width)}x${Math.round(rect.height)}px`
            });
            m.fitts.top_3_hardest.sort((a, b) => b.id - a.id);
            if (m.fitts.top_3_hardest.length > 3) {
                m.fitts.top_3_hardest.length = 3;
            }
        }
    }

    recordingState.lastClickPosition = { x: payload.x, y: payload.y };
    recordingState.lastClickTarget = clickTarget;

    // Update averages (movements = clicks - 1)
    const movements = m.click_count.total - 1;
    if (movements > 0) {
        m.fitts.average_id = m.fitts.cumulative_id / movements;
        m.scanning_distance.average_px = m.scanning_distance.cumulative_px / movements;
    }
}

/** Append click to the action log (ring buffer capped at ACTION_LOG_MAX) */
function appendActionLog(recording: BenchmarkReport, payload: ClickPayload) {
    recording.action_log.push({
        type: payload.type,
        timestamp: payload.timestamp,
        target: payload.target.tagName + (payload.target.id ? '#' + payload.target.id : ''),
        text: payload.target.innerText || '',
        classification: payload.classification || 'productive'
    });
    if (recording.action_log.length > ACTION_LOG_MAX) {
        recording.action_log = recording.action_log.slice(-ACTION_LOG_MAX);
    }
}

function processClickEvent(recording: BenchmarkReport, payload: ClickPayload, recordingState: RecordingState): boolean {
    const clickTarget = payload.target?.innerText?.substring(0, 40) || payload.target?.tagName || 'click';
    recordingState.lastActionLabel = clickTarget;

    classifyAndCount(recording.metrics, payload);
    computeFittsAndScanning(recording.metrics, payload, clickTarget, recordingState);
    appendActionLog(recording, payload);

    return true;
}

function processScrollEvent(recording: BenchmarkReport, payload: ScrollPayload): boolean {
    recording.metrics.scroll_distance.total_px = payload.total_px;
    recording.metrics.scroll_distance.page_scroll_px = payload.page_scroll_px;
    recording.metrics.scroll_distance.container_scroll_px = payload.container_scroll_px;
    recording.metrics.scroll_distance.total_horizontal_px = payload.total_horizontal_px || 0;
    recording.metrics.scroll_distance.scroll_events = payload.scroll_events;
    recording.metrics.scroll_distance.heaviest_container = payload.heaviest_container;
    return true;
}

function processKeyboardEvent(recording: BenchmarkReport, payload: KeyboardPayload, recordingState: RecordingState): boolean {
    recordingState.lastActionLabel = 'keyboard';

    const cs = payload.context_switches;
    recording.metrics.context_switches.total = cs.total;
    recording.metrics.context_switches.ratio = cs.ratio;
    recording.metrics.context_switches.longest_keyboard_streak = cs.longest_keyboard_streak;
    recording.metrics.context_switches.longest_mouse_streak = cs.longest_mouse_streak;

    recording.metrics.shortcut_coverage.shortcuts_used = payload.shortcut_coverage.shortcuts_used;

    const tr = payload.typing_ratio;
    recording.metrics.typing_ratio.free_text_inputs = tr.free_text_inputs;
    recording.metrics.typing_ratio.constrained_inputs = tr.constrained_inputs;
    recording.metrics.typing_ratio.ratio = tr.ratio;
    recording.metrics.typing_ratio.free_text_fields = tr.free_text_fields;

    return true;
}

function processDepthEvent(recording: BenchmarkReport, payload: DepthPayload): boolean {
    const nd = payload.navigation_depth;
    const prev = recording.metrics.navigation_depth;
    const changed = prev.max_depth !== nd.max_depth || prev.total_depth_changes !== nd.total_depth_changes;
    prev.max_depth = nd.max_depth;
    prev.total_depth_changes = nd.total_depth_changes;
    prev.deepest_moment = nd.deepest_moment;
    prev.depth_path = nd.depth_path;
    return changed;
}

function processDensityEvent(recording: BenchmarkReport, payload: DensityPayload): boolean {
    const id = payload.information_density;
    const prev = recording.metrics.information_density;
    const changed = prev.average_content_ratio !== id.average_content_ratio;
    prev.average_content_ratio = id.average_content_ratio;
    prev.min_content_ratio = id.min_content_ratio;
    prev.max_content_ratio = id.max_content_ratio;
    prev.min_content_context = id.min_content_context;
    prev.max_content_context = id.max_content_context;
    return changed;
}

function processWaitEvent(recording: BenchmarkReport, payload: WaitPayload): boolean {
    const prev = recording.metrics.time_on_task.application_wait_ms;
    const next = payload.application_wait_ms || 0;
    recording.metrics.time_on_task.application_wait_ms = next;
    return prev !== next;
}

// ========================================================
// Event handling — router
// ========================================================

async function handleEventInternal(payload: EventPayload) {
    const { recordingState } = await chrome.storage.local.get('recordingState');
    if (!recordingState?.isRecording || !recordingState.currentRecording) return;

    const recording = recordingState.currentRecording as BenchmarkReport;
    const now = (payload as ClickPayload).timestamp || Date.now();

    // Idle gap detection — only for user-initiated actions (not passive sensors like density/depth/wait)
    const isUserAction = payload.type === 'click' || payload.type === 'keyboard_update' || payload.type === 'scroll_update';
    if (isUserAction) {
        detectIdleGap(recording, payload, recordingState, now);
    }

    // Dispatch to per-type processor
    let stateChanged = false;
    switch (payload.type) {
        case 'click':          stateChanged = processClickEvent(recording, payload as ClickPayload, recordingState); break;
        case 'scroll_update':  stateChanged = processScrollEvent(recording, payload as ScrollPayload); break;
        case 'keyboard_update': stateChanged = processKeyboardEvent(recording, payload as KeyboardPayload, recordingState); break;
        case 'depth_update':   stateChanged = processDepthEvent(recording, payload as DepthPayload); break;
        case 'density_update': stateChanged = processDensityEvent(recording, payload as DensityPayload); break;
        case 'wait_update':    stateChanged = processWaitEvent(recording, payload as WaitPayload); break;
    }

    if (!stateChanged) return;

    // Live composite score (single source: computeComposite)
    const m = recording.metrics;
    const compositeRounded = Math.round(computeComposite(m) * 10) / 10;

    // Build comprehensive stats for recovery (side panel opening mid-recording)
    const stats = {
        clicks: m.click_count.total,
        depth: m.navigation_depth.max_depth,
        scroll: Math.round(m.scroll_distance.total_px),
        switches: m.context_switches.total,
        composite: compositeRounded,
        fitts: round2(m.fitts.average_id),
        density: round2(m.information_density.average_content_ratio),
        shortcuts: m.shortcut_coverage.shortcuts_used,
        typing: round2(m.typing_ratio.ratio),
        scanAvg: Math.round(m.scanning_distance.average_px),
        waitMs: m.time_on_task.application_wait_ms || 0
    };

    // Write updated recording state and all metric stats
    await chrome.storage.local.set({ recordingState, stats });

    // Build and broadcast FEED_EVENT for real-time side panel updates
    const feedEvent = buildFeedEvent(payload, m, compositeRounded, now);
    if (feedEvent) {
        chrome.runtime.sendMessage({ type: 'FEED_EVENT', event: feedEvent }).catch(NOOP);
    }
}

// ========================================================
// Feed event builders — one per event type (R14: dispatch table)
// ========================================================

type FeedBuilderFn = (payload: EventPayload, m: Metrics, id: number, ts: number,
    metricUpdates: Record<string, { value: string }>) => FeedEvent | null;

function buildClickFeed(payload: EventPayload, _m: Metrics, id: number, ts: number,
    metricUpdates: Record<string, { value: string }>): FeedEvent {
    const p = payload as ClickPayload;
    const tag = p.target?.tagName || 'EL';
    const elId = p.target?.id ? '#' + p.target.id : '';
    const text = p.target?.innerText?.substring(0, 25) || '';
    const cls = p.classification || 'productive';
    return {
        id, ts, type: 'click',
        label: `CLK ${tag}${elId}`,
        detail: cls !== 'productive' ? `${cls}: ${p.classificationReason || text}` : text,
        metricUpdates
    };
}

function buildScrollFeed(payload: EventPayload, _m: Metrics, id: number, ts: number,
    metricUpdates: Record<string, { value: string }>): FeedEvent | null {
    const scrollNow = Date.now();
    if (scrollNow - lastScrollFeedTime < SCROLL_FEED_THROTTLE_MS) return null;
    lastScrollFeedTime = scrollNow;

    const delta = Math.round((payload as ScrollPayload).total_px - lastScrollTotal);
    lastScrollTotal = (payload as ScrollPayload).total_px;
    return {
        id, ts, type: 'scroll',
        label: `SCROLL +${formatCompact(delta)}px`,
        metricUpdates
    };
}

function buildKeyboardFeed(_payload: EventPayload, m: Metrics, id: number, ts: number,
    metricUpdates: Record<string, { value: string }>): FeedEvent {
    const parts: string[] = [];
    if (m.context_switches.total > 0) parts.push(`sw:${m.context_switches.total}`);
    if (m.shortcut_coverage.shortcuts_used > 0) parts.push(`shortcuts:${m.shortcut_coverage.shortcuts_used}`);
    if (m.typing_ratio.ratio > 0) parts.push(`typing:${round2(m.typing_ratio.ratio)}`);
    return {
        id, ts, type: 'keyboard',
        label: `KBD ${parts.join(' ')}`,
        metricUpdates
    };
}

function buildDepthFeed(payload: EventPayload, m: Metrics, id: number, ts: number,
    metricUpdates: Record<string, { value: string }>): FeedEvent {
    const path = (payload as DepthPayload).navigation_depth?.depth_path || [];
    const last = path[path.length - 1];
    const direction = last?.direction || 'change';
    const layer = last?.layer || 'layer';
    return {
        id, ts, type: 'depth',
        label: `DEPTH ${direction} ${layer}`,
        detail: `max: ${m.navigation_depth.max_depth}`,
        metricUpdates
    };
}

function buildDensityFeed(_payload: EventPayload, m: Metrics, id: number, ts: number,
    metricUpdates: Record<string, { value: string }>): FeedEvent {
    const pct = Math.round(m.information_density.average_content_ratio * 100);
    return {
        id, ts, type: 'density',
        label: `DENSITY ${pct}%`,
        metricUpdates
    };
}

function buildWaitFeed(_payload: EventPayload, m: Metrics, id: number, ts: number,
    metricUpdates: Record<string, { value: string }>): FeedEvent {
    const waitMs = m.time_on_task.application_wait_ms || 0;
    return {
        id, ts, type: 'wait',
        label: `WAIT ${METRIC_FORMATS.wait.format(waitMs)}`,
        metricUpdates
    };
}

/** Dispatch table: event type → feed label builder */
const FEED_BUILDERS: Record<string, FeedBuilderFn> = {
    'click':           buildClickFeed,
    'scroll_update':   buildScrollFeed,
    'keyboard_update': buildKeyboardFeed,
    'depth_update':    buildDepthFeed,
    'density_update':  buildDensityFeed,
    'wait_update':     buildWaitFeed,
};

// ========================================================
// Feed event orchestrator (R4: data-driven metric snapshot)
// ========================================================

function buildFeedEvent(payload: EventPayload, m: Metrics, composite: number, ts: number): FeedEvent | null {
    feedCounter++;
    const id = feedCounter;

    // Build metric snapshot via data-driven loop
    const metricUpdates = buildMetricSnapshot(m, composite);

    // Check for idle gap that was just recorded
    const gaps = m.time_on_task.idle_gaps || [];
    if (gaps.length > 0) {
        const lastGap = gaps[gaps.length - 1];
        if (lastGap && lastGap._emitted !== true) {
            lastGap._emitted = true;
            const gapSec = round2(lastGap.gap_ms / 1000);
            chrome.runtime.sendMessage({
                type: 'FEED_EVENT',
                event: {
                    id: id - 0.5,
                    ts,
                    type: 'gap',
                    label: `GAP ${gapSec}s idle`,
                    detail: `after: ${lastGap.after_action}`,
                    metricUpdates: {}
                }
            }).catch(NOOP);
        }
    }

    const builder = FEED_BUILDERS[payload.type];
    if (!builder) return null;
    return builder(payload, m, id, ts, metricUpdates);
}
