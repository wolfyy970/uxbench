/// <reference types="chrome"/>

import { ClickCollector } from './clicks';
import { ScrollCollector } from './scroll';
import { KeyboardCollector } from './keyboard';
import { DepthCollector } from './depth';
import { DensityCollector } from './density';

class Collector {
    private isRecording = false;
    private clickCollector: ClickCollector;
    private scrollCollector: ScrollCollector;
    private keyboardCollector: KeyboardCollector;
    private depthCollector: DepthCollector;
    private densityCollector: DensityCollector;

    constructor() {
        this.clickCollector = new ClickCollector();
        this.scrollCollector = new ScrollCollector();
        this.keyboardCollector = new KeyboardCollector();
        this.depthCollector = new DepthCollector();
        this.densityCollector = new DensityCollector();

        // When a click is captured, also notify keyboard collector (for context switch tracking)
        // and density collector (to sample at interaction time)
        this.clickCollector.onClickCaptured = () => {
            this.keyboardCollector.notifyMouseAction();
            this.densityCollector.sampleOnInteraction();
        };

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

        // Check initial state (handles page load during active recording)
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

        this.addOverlay();

        this.clickCollector.attach();
        this.scrollCollector.attach();
        this.keyboardCollector.attach();
        this.depthCollector.attach();
        this.densityCollector.attach();
    }

    private stop() {
        if (!this.isRecording) return;
        this.isRecording = false;
        console.log('UX Bench: Recording stopped');

        this.removeOverlay();

        this.clickCollector.detach();
        this.scrollCollector.detach();
        this.keyboardCollector.detach();
        this.depthCollector.detach();
        this.densityCollector.detach();
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
