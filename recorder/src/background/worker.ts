/// <reference types="chrome"/>

interface RecordingState {
    isRecording: boolean;
    startTime?: number;
    lastClickPosition?: { x: number; y: number } | null;
    currentRecording?: any;
}

const initialState: RecordingState = {
    isRecording: false
};

let isTransitioning = false;

// Initialize state
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ recordingState: initialState });
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// Handle keyboard shortcuts
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

// Message handling from side panel and content scripts
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

async function startRecording() {
    console.log('UXBench: Starting recording...');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const now = Date.now();

    const state: RecordingState = {
        isRecording: true,
        startTime: now,
        lastClickPosition: null,
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
                    total_ms: 0, application_wait_ms: 0, confusion_gaps: []
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
                shortcut_coverage: {
                    shortcuts_used: 0, mouse_with_shortcut: 0,
                    ratio: 0, missed_shortcuts: []
                },
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

    // Clear previous stats and report, write new state
    await chrome.storage.local.set({
        recordingState: state,
        stats: null,
        benchmarkReport: null
    });

    // Notify content script
    if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'RECORDING_STARTED' }).catch(() => {});
    }

    // Badge (only if action is configured in manifest)
    if (chrome.action) {
        chrome.action.setBadgeText({ text: 'REC' }).catch(() => {});
        chrome.action.setBadgeBackgroundColor({ color: '#FF0000' }).catch(() => {});
    }

    // Notify side panel and other extension pages
    chrome.runtime.sendMessage({ type: 'RECORDING_STARTED' }).catch(() => {});
}

async function stopRecording() {
    console.log('UXBench: Stopping recording...');
    const { recordingState } = await chrome.storage.local.get('recordingState');
    if (!recordingState?.isRecording) return;

    // Calculate duration
    const duration = Date.now() - (recordingState.startTime || Date.now());

    // Build the final benchmark report
    const report = recordingState.currentRecording;
    if (report) {
        report.metadata.duration_ms = duration;
        report.metrics.time_on_task.total_ms = duration;
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
        chrome.tabs.sendMessage(tab.id, { type: 'RECORDING_STOPPED' }).catch(() => {});
    }

    // Clear badge (only if action is configured in manifest)
    if (chrome.action) {
        chrome.action.setBadgeText({ text: '' }).catch(() => {});
    }

    // Notify side panel and other extension pages
    chrome.runtime.sendMessage({ type: 'RECORDING_STOPPED' }).catch(() => {});
}

async function handleEvent(payload: any) {
    const { recordingState } = await chrome.storage.local.get('recordingState');
    if (!recordingState?.isRecording || !recordingState.currentRecording) return;

    const recording = recordingState.currentRecording;
    let stateChanged = false;

    if (payload.type === 'click') {
        recording.metrics.click_count.total += 1;

        // Scanning distance & Fitts ID between consecutive clicks
        if (recordingState.lastClickPosition) {
            const dx = payload.x - recordingState.lastClickPosition.x;
            const dy = payload.y - recordingState.lastClickPosition.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            recording.metrics.scanning_distance.cumulative_px += distance;
            if (distance > recording.metrics.scanning_distance.max_single_px) {
                recording.metrics.scanning_distance.max_single_px = distance;
            }

            // Fitts's Law: Shannon formulation
            const rect = payload.target.rect;
            const targetWidth = Math.min(rect.width, rect.height);
            if (targetWidth > 0 && distance > 0) {
                const id = Math.log2(distance / targetWidth + 1);
                recording.metrics.fitts.cumulative_id += id;
                if (id > recording.metrics.fitts.max_id) {
                    recording.metrics.fitts.max_id = id;
                    recording.metrics.fitts.max_id_element =
                        payload.target.innerText || payload.target.tagName;
                    recording.metrics.fitts.max_id_distance_px = distance;
                    recording.metrics.fitts.max_id_target_size =
                        `${Math.round(rect.width)}x${Math.round(rect.height)}px`;
                }
            }
        }
        recordingState.lastClickPosition = { x: payload.x, y: payload.y };

        // Update averages (movements = clicks - 1)
        const movements = recording.metrics.click_count.total - 1;
        if (movements > 0) {
            recording.metrics.fitts.average_id =
                recording.metrics.fitts.cumulative_id / movements;
            recording.metrics.scanning_distance.average_px =
                recording.metrics.scanning_distance.cumulative_px / movements;
        }

        // Action log
        recording.action_log.push({
            type: payload.type,
            timestamp: payload.timestamp,
            target: payload.target.tagName + (payload.target.id ? '#' + payload.target.id : ''),
            text: payload.target.innerText
        });
        stateChanged = true;

    } else if (payload.type === 'scroll_update') {
        // Overwrite with latest cumulative values from ScrollCollector
        recording.metrics.scroll_distance.total_px = payload.total_px;
        recording.metrics.scroll_distance.page_scroll_px = payload.page_scroll_px;
        recording.metrics.scroll_distance.container_scroll_px = payload.container_scroll_px;
        recording.metrics.scroll_distance.scroll_events = payload.scroll_events;
        recording.metrics.scroll_distance.heaviest_container = payload.heaviest_container;
        stateChanged = true;

    } else if (payload.type === 'keyboard_update') {
        // Overwrite with latest cumulative values from KeyboardCollector
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
        stateChanged = true;

    } else if (payload.type === 'depth_update') {
        // Overwrite with latest from DepthCollector
        const nd = payload.navigation_depth;
        recording.metrics.navigation_depth.max_depth = nd.max_depth;
        recording.metrics.navigation_depth.total_depth_changes = nd.total_depth_changes;
        recording.metrics.navigation_depth.deepest_moment = nd.deepest_moment;
        recording.metrics.navigation_depth.depth_path = nd.depth_path;
        stateChanged = true;

    } else if (payload.type === 'density_update') {
        // Overwrite with latest from DensityCollector
        const id = payload.information_density;
        recording.metrics.information_density.average_content_ratio = id.average_content_ratio;
        recording.metrics.information_density.min_content_ratio = id.min_content_ratio;
        recording.metrics.information_density.max_content_ratio = id.max_content_ratio;
        recording.metrics.information_density.min_content_context = id.min_content_context;
        recording.metrics.information_density.max_content_context = id.max_content_context;
        stateChanged = true;
    }

    if (!stateChanged) return;

    // Write updated recording state back
    await chrome.storage.local.set({ recordingState });

    // Write live telemetry stats for side panel polling
    await chrome.storage.local.set({
        stats: {
            clicks: recording.metrics.click_count.total,
            depth: recording.metrics.navigation_depth.max_depth,
            scroll: Math.round(recording.metrics.scroll_distance.total_px),
            switches: recording.metrics.context_switches.total
        }
    });
}
