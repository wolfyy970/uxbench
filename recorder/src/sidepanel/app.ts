/// <reference types="chrome"/>

const actionBtn = document.getElementById('actionBtn') as HTMLButtonElement;
const downloadBtn = document.getElementById('downloadBtn') as HTMLButtonElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const resSelect = document.getElementById('resSelect') as HTMLSelectElement;
const liveTime = document.getElementById('liveTime') as HTMLSpanElement;
const runCount = document.getElementById('runCount') as HTMLSpanElement;
const liveClicks = document.getElementById('liveClicks') as HTMLSpanElement;
const liveDepth = document.getElementById('liveDepth') as HTMLSpanElement;
const liveScroll = document.getElementById('liveScroll') as HTMLSpanElement;
const liveSwitches = document.getElementById('liveSwitches') as HTMLSpanElement;

let telemetryInterval: any;
let sessionRuns: any[] = [];

// State Validation
function validateState() {
    const isRecording = document.body.classList.contains('recording');
    const viewportSelected = resSelect.value !== "";
    const hasRuns = sessionRuns.length > 0;

    // 1. START/STOP/REPEAT Button
    if (isRecording) {
        actionBtn.textContent = 'STOP';
        actionBtn.disabled = false;
    } else {
        actionBtn.textContent = hasRuns ? 'REPEAT TEST' : 'START';
        actionBtn.disabled = !viewportSelected;
    }

    // 2. DOWNLOAD Button
    downloadBtn.disabled = isRecording || !hasRuns || !viewportSelected;

    // 3. CLEAR Button
    clearBtn.disabled = isRecording || !hasRuns;

    // 4. Viewport Select
    resSelect.disabled = isRecording;

    // 5. Run Count
    if (runCount) runCount.textContent = `RUNS: ${sessionRuns.length}`;
}

// Resolution Logic
resSelect.addEventListener('change', async (e) => {
    validateState();

    const target = (e.target as HTMLSelectElement).value;
    if (!target) return;

    const [wStr, hStr] = target.split('x');
    const targetW = parseInt(wStr);
    const targetH = parseInt(hStr);

    const windowObj = await chrome.windows.getCurrent();
    const [tab] = await chrome.tabs.query({ active: true, windowId: windowObj.id });

    if (!tab.id || !windowObj.id) return;

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
});

// Action (Start/Stop) Logic
// Only sends command to worker. UI updates come from worker's broadcast messages.
actionBtn.addEventListener('click', () => {
    if (actionBtn.disabled) return;

    const isRecording = document.body.classList.contains('recording');
    if (isRecording) {
        chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
    } else {
        chrome.runtime.sendMessage({ type: 'START_RECORDING' });
    }
    // Disable to prevent double-clicks while worker processes
    actionBtn.disabled = true;
});

// Clear Logic
clearBtn.addEventListener('click', () => {
    sessionRuns = [];
    chrome.storage.local.set({ sessionRuns: [] });
    chrome.storage.local.remove(['benchmarkReport', 'stats']);

    if (liveClicks) liveClicks.textContent = "--";
    if (liveDepth) liveDepth.textContent = "--";
    if (liveScroll) liveScroll.textContent = "--";
    if (liveSwitches) liveSwitches.textContent = "--";
    if (liveTime) liveTime.textContent = "00:00";
    validateState();
});

async function updateUI(isRecording: boolean) {
    if (isRecording) {
        document.body.classList.add('recording');
        startTelemetry();
    } else {
        document.body.classList.remove('recording');
        stopTelemetry();

        // Fetch the just-finished report and add to session.
        // Worker writes benchmarkReport BEFORE sending RECORDING_STOPPED,
        // so it is guaranteed to be available here.
        const { benchmarkReport } = await chrome.storage.local.get('benchmarkReport');
        if (benchmarkReport) {
            sessionRuns.push(benchmarkReport);
            await chrome.storage.local.set({ sessionRuns });
            // Clear from storage to prevent re-pushing on panel reopen
            await chrome.storage.local.remove('benchmarkReport');
        }
    }
    validateState();
}

// Telemetry (polls storage every second for live stats + timer)
function startTelemetry() {
    // Reset telemetry display
    if (liveClicks) liveClicks.textContent = "0";
    if (liveDepth) liveDepth.textContent = "1";
    if (liveScroll) liveScroll.textContent = "0";
    if (liveSwitches) liveSwitches.textContent = "0";
    if (liveTime) liveTime.textContent = "00:00";

    telemetryInterval = setInterval(async () => {
        const { stats, recordingState } = await chrome.storage.local.get(['stats', 'recordingState']);

        // Update live stats
        if (stats) {
            if (liveClicks) liveClicks.textContent = (stats.clicks || 0).toString();
            if (liveDepth) liveDepth.textContent = (stats.depth || 1).toString();
            if (liveScroll) liveScroll.textContent = (stats.scroll || 0).toString();
            if (liveSwitches) liveSwitches.textContent = (stats.switches || 0).toString();
        }

        // Update live timer from startTime
        if (recordingState?.startTime && liveTime) {
            const elapsed = Date.now() - recordingState.startTime;
            const seconds = Math.floor(elapsed / 1000);
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            liveTime.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }
    }, 1000);
}

function stopTelemetry() {
    clearInterval(telemetryInterval);
    // Show idle state — telemetry values stay at their final values,
    // but we don't reset to "--" here so the user can see what was recorded.
}

// Download Handler (Averaging)
downloadBtn.addEventListener('click', async () => {
    if (downloadBtn.disabled || sessionRuns.length === 0) return;

    // Filter to only valid runs
    const validRuns = sessionRuns.filter(run =>
        run && run.metrics && run.metrics.click_count &&
        typeof run.metrics.click_count.total === 'number'
    );

    if (validRuns.length === 0) {
        console.warn('UXBench: No valid runs to average');
        return;
    }

    // Clone the last valid run as a base
    const baseReport = JSON.parse(JSON.stringify(validRuns[validRuns.length - 1]));
    const count = validRuns.length;

    // Accumulate all averageable metrics across valid runs
    const sums = {
        clicks: 0, time: 0, depth: 0,
        fittsCum: 0, fittsAvg: 0, fittsMax: 0,
        scanCum: 0, scanAvg: 0, scanMax: 0,
        scrollTotal: 0, scrollPage: 0, scrollContainer: 0, scrollEvents: 0,
        ctxSwitches: 0, ctxRatio: 0,
        shortcuts: 0,
        typingFree: 0, typingConstrained: 0, typingRatio: 0,
        densityAvg: 0, densityMin: 0, densityMax: 0
    };

    validRuns.forEach(run => {
        const m = run.metrics;
        sums.clicks += (m.click_count?.total || 0);
        sums.time += (m.time_on_task?.total_ms || 0);
        sums.depth += (m.navigation_depth?.max_depth || 1);
        sums.fittsCum += (m.fitts?.cumulative_id || 0);
        sums.fittsAvg += (m.fitts?.average_id || 0);
        sums.fittsMax += (m.fitts?.max_id || 0);
        sums.scanCum += (m.scanning_distance?.cumulative_px || 0);
        sums.scanAvg += (m.scanning_distance?.average_px || 0);
        sums.scanMax += (m.scanning_distance?.max_single_px || 0);
        sums.scrollTotal += (m.scroll_distance?.total_px || 0);
        sums.scrollPage += (m.scroll_distance?.page_scroll_px || 0);
        sums.scrollContainer += (m.scroll_distance?.container_scroll_px || 0);
        sums.scrollEvents += (m.scroll_distance?.scroll_events || 0);
        sums.ctxSwitches += (m.context_switches?.total || 0);
        sums.ctxRatio += (m.context_switches?.ratio || 0);
        sums.shortcuts += (m.shortcut_coverage?.shortcuts_used || 0);
        sums.typingFree += (m.typing_ratio?.free_text_inputs || 0);
        sums.typingConstrained += (m.typing_ratio?.constrained_inputs || 0);
        sums.typingRatio += (m.typing_ratio?.ratio || 0);
        sums.densityAvg += (m.information_density?.average_content_ratio || 0);
        sums.densityMin += (m.information_density?.min_content_ratio || 0);
        sums.densityMax += (m.information_density?.max_content_ratio || 0);
    });

    const round2 = (v: number) => Math.round(v * 100) / 100;

    // Write averages into the base report
    baseReport.metrics.click_count.total = Math.round(sums.clicks / count);
    baseReport.metrics.time_on_task.total_ms = Math.round(sums.time / count);
    baseReport.metrics.navigation_depth.max_depth = Math.round(sums.depth / count);
    baseReport.metrics.fitts.cumulative_id = round2(sums.fittsCum / count);
    baseReport.metrics.fitts.average_id = round2(sums.fittsAvg / count);
    baseReport.metrics.fitts.max_id = round2(sums.fittsMax / count);
    baseReport.metrics.scanning_distance.cumulative_px = Math.round(sums.scanCum / count);
    baseReport.metrics.scanning_distance.average_px = Math.round(sums.scanAvg / count);
    baseReport.metrics.scanning_distance.max_single_px = Math.round(sums.scanMax / count);
    baseReport.metrics.scroll_distance.total_px = Math.round(sums.scrollTotal / count);
    baseReport.metrics.scroll_distance.page_scroll_px = Math.round(sums.scrollPage / count);
    baseReport.metrics.scroll_distance.container_scroll_px = Math.round(sums.scrollContainer / count);
    baseReport.metrics.scroll_distance.scroll_events = Math.round(sums.scrollEvents / count);
    baseReport.metrics.context_switches.total = Math.round(sums.ctxSwitches / count);
    baseReport.metrics.context_switches.ratio = round2(sums.ctxRatio / count);
    baseReport.metrics.shortcut_coverage.shortcuts_used = Math.round(sums.shortcuts / count);
    baseReport.metrics.typing_ratio.free_text_inputs = Math.round(sums.typingFree / count);
    baseReport.metrics.typing_ratio.constrained_inputs = Math.round(sums.typingConstrained / count);
    baseReport.metrics.typing_ratio.ratio = round2(sums.typingRatio / count);
    baseReport.metrics.information_density.average_content_ratio = round2(sums.densityAvg / count);
    baseReport.metrics.information_density.min_content_ratio = round2(sums.densityMin / count);
    baseReport.metrics.information_density.max_content_ratio = round2(sums.densityMax / count);

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

// Initialize: sync visual state from storage without calling updateUI
// (which would re-push a stale benchmarkReport)
chrome.storage.local.get(['recordingState', 'sessionRuns']).then(({ recordingState, sessionRuns: storedRuns }) => {
    sessionRuns = storedRuns || [];

    if (recordingState?.isRecording) {
        document.body.classList.add('recording');
        startTelemetry();
    } else {
        document.body.classList.remove('recording');
    }
    validateState();
});

// Listen for state change broadcasts from the worker.
// This is the ONLY path that calls updateUI — no double-fires.
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'RECORDING_STARTED') updateUI(true);
    if (message.type === 'RECORDING_STOPPED') updateUI(false);
});
