/// <reference types="chrome"/>

// Content script that orchestrates collection
import { ClickCollector } from './clicks';
// Import other collectors...

class Collector {
    private isRecording = false;
    private clickCollector: ClickCollector;

    constructor() {
        this.clickCollector = new ClickCollector();
        this.initListeners();
    }

    private initListeners() {
        chrome.runtime.onMessage.addListener((message) => {
            if (message.type === 'RECORDING_STARTED') {
                this.start();
            } else if (message.type === 'RECORDING_STOPPED') {
                this.stop();
            }
        });

        // Check initial state
        chrome.storage.local.get('recordingState').then(({ recordingState }) => {
            if (recordingState?.isRecording) {
                this.start();
            }
        });
    }

    private start() {
        if (this.isRecording) return;
        this.isRecording = true;
        console.log('UX Bench: Recording started');

        // Add visual indicator
        this.addOverlay();

        // Start collectors
        this.clickCollector.attach();
    }

    private stop() {
        if (!this.isRecording) return;
        this.isRecording = false;
        console.log('UX Bench: Recording stopped');

        // Remove visual indicator
        this.removeOverlay();

        // Stop collectors
        this.clickCollector.detach();
    }

    private addOverlay() {
        const div = document.createElement('div');
        div.id = 'uxbench-overlay';
        div.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: red;
      color: white;
      padding: 8px 12px;
      border-radius: 4px;
      z-index: 2147483647;
      font-family: sans-serif;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      pointer-events: none;
    `;
        div.textContent = 'REC ●';
        document.body.appendChild(div);
    }

    private removeOverlay() {
        const div = document.getElementById('uxbench-overlay');
        if (div) div.remove();
    }
}

new Collector();
