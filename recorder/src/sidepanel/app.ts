/// <reference types="chrome"/>

const actionBtn = document.getElementById('actionBtn') as HTMLButtonElement;
const downloadBtn = document.getElementById('downloadBtn') as HTMLButtonElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const resSelect = document.getElementById('resSelect') as HTMLSelectElement;
const liveTime = document.getElementById('liveTime') as HTMLSpanElement;
const runCount = document.getElementById('runCount') as HTMLSpanElement;
const liveClicks = document.getElementById('liveClicks') as HTMLSpanElement;
const liveDepth = document.getElementById('liveDepth') as HTMLSpanElement;

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
        // If we have existing runs, it's a "REPEAT"
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
    validateState(); // Re-check buttons

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
actionBtn.addEventListener('click', () => {
    if (actionBtn.disabled) return;

    const isRecording = document.body.classList.contains('recording');
    if (isRecording) {
        chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
        // The actual run saving happens in updateUI(false) or the event listener
        updateUI(false);
    } else {
        // START/REPEAT: Do NOT clear sessionRuns
        chrome.runtime.sendMessage({ type: 'START_RECORDING' });
        updateUI(true);
    }
});

// Clear Logic
clearBtn.addEventListener('click', () => {
    sessionRuns = [];
    chrome.storage.local.set({ sessionRuns: [] });
    chrome.storage.local.remove(['benchmarkReport', 'stats']);

    if (liveClicks) liveClicks.textContent = "0";
    if (liveDepth) liveDepth.textContent = "1";
    validateState();
});

async function updateUI(isRecording: boolean) {
    if (isRecording) {
        document.body.classList.add('recording');
        startTelemetry();
    } else {
        document.body.classList.remove('recording');
        stopTelemetry();

        // STOPPED: Fetch the just-finished report and add to session
        const { benchmarkReport } = await chrome.storage.local.get('benchmarkReport');
        if (benchmarkReport) {
            sessionRuns.push(benchmarkReport);
            await chrome.storage.local.set({ sessionRuns });
        }
    }
    validateState();
}

// Telemetry
function startTelemetry() {
    telemetryInterval = setInterval(async () => {
        const { stats } = await chrome.storage.local.get('stats');
        if (stats) {
            if (liveClicks) liveClicks.textContent = (stats.clicks || 0).toString();
            if (liveDepth) liveDepth.textContent = (stats.depth || 1).toString();
        }
    }, 1000);
}

function stopTelemetry() {
    clearInterval(telemetryInterval);
}

// Download Handler (Averaging)
downloadBtn.addEventListener('click', async () => {
    if (downloadBtn.disabled || sessionRuns.length === 0) return;

    // Calculated Averaged Report
    // Clone the first report as a base
    const baseReport = JSON.parse(JSON.stringify(sessionRuns[sessionRuns.length - 1]));

    // Calculate Averages
    let totalClicks = 0;
    let totalTime = 0;
    let totalDepth = 0;

    sessionRuns.forEach(run => {
        if (run.metrics) {
            totalClicks += (run.metrics.click_count?.total || 0);
            totalTime += (run.metrics.time_on_task?.total_ms || 0);
            totalDepth += (run.metrics.navigation_depth?.max_depth || 1);
        }
    });

    const count = sessionRuns.length;

    // Update baseReport with averages
    if (!baseReport.metrics) baseReport.metrics = {};
    if (!baseReport.metrics.click_count) baseReport.metrics.click_count = {};
    if (!baseReport.metrics.time_on_task) baseReport.metrics.time_on_task = {};
    if (!baseReport.metrics.navigation_depth) baseReport.metrics.navigation_depth = {};

    baseReport.metrics.click_count.total = Math.round(totalClicks / count);
    baseReport.metrics.time_on_task.total_ms = Math.round(totalTime / count);
    baseReport.metrics.navigation_depth.max_depth = Math.round(totalDepth / count);

    // Metadata
    if (!baseReport.metadata) baseReport.metadata = {};
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

// Initialize
chrome.storage.local.get(['recordingState', 'sessionRuns']).then(({ recordingState, sessionRuns: storedRuns }) => {
    const isRec = recordingState?.isRecording || false;
    sessionRuns = storedRuns || [];
    updateUI(isRec);
});

chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'RECORDING_STARTED') updateUI(true);
    if (message.type === 'RECORDING_STOPPED') updateUI(false);
});
