/// <reference types="chrome"/>

// State management for the recording session
interface RecordingState {
    isRecording: boolean;
    startTime?: number;
    currentRecording?: any; // typed as Partial<BenchmarkReport> in real imp
}

const initialState: RecordingState = {
    isRecording: false
};

// Initialize state
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ recordingState: initialState });
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'toggle-recording') {
        const { recordingState } = await chrome.storage.local.get('recordingState');
        if (recordingState.isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    }
});

// Message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'START_RECORDING') {
        startRecording();
    } else if (message.type === 'STOP_RECORDING') {
        stopRecording();
    } else if (message.type === 'EVENT_CAPTURED') {
        handleEvent(message.payload);
    }
});

async function startRecording() {
    console.log('Starting recording...');
    const state: RecordingState = {
        isRecording: true,
        startTime: Date.now(),
        currentRecording: {
            metrics: {
                click_count: { total: 0, productive: 0, ceremonial: 0, wasted: 0 },
                // ... initialize other metrics
            }
        }
    };
    await chrome.storage.local.set({ recordingState: state });

    // Notify active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'RECORDING_STARTED' });
        chrome.action.setIcon({ path: 'icons/recording-on.png' }); // hypothetical icon
        chrome.action.setBadgeText({ text: 'REC' });
        chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
    }
}

async function stopRecording() {
    console.log('Stopping recording...');
    const { recordingState } = await chrome.storage.local.get('recordingState');
    if (!recordingState.isRecording) return;

    const finalState = { ...recordingState, isRecording: false };
    await chrome.storage.local.set({ recordingState: finalState });

    // Notify active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'RECORDING_STOPPED' });
        chrome.action.setBadgeText({ text: '' });
    }

    // Open side panel to show results
    // chrome.sidePanel.open({ windowId: tab.windowId }); // Requires user interaction usually
}

async function handleEvent(payload: any) {
    // Aggregate events in storage
    const { recordingState } = await chrome.storage.local.get('recordingState');
    if (!recordingState.isRecording) return;

    // Example: append event to log or update metric
    // This would be more complex in real implementation
    console.log('Event captured:', payload);
}
