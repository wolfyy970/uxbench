/// <reference types="chrome"/>

import { ClickCollector } from './clicks';
import { ScrollCollector } from './scroll';
import { KeyboardCollector } from './keyboard';
import { DepthCollector } from './depth';
import { DensityCollector } from './density';
import { WaitCollector } from './wait';

/** Brand color shared with worker badge (#EE6019) */
const BRAND_ORANGE = '#EE6019';
/** Max int32 — ensures overlay renders above all page content */
const Z_TOP = 2147483647;

const OVERLAY_CSS = `
    position: fixed; bottom: 20px; right: 20px;
    background: ${BRAND_ORANGE}; color: white;
    padding: 8px 12px; border-radius: 4px;
    z-index: ${Z_TOP};
    font-family: sans-serif;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    pointer-events: none;
`;

class Collector {
    private isRecording = false;
    private clickCollector: ClickCollector;
    private scrollCollector: ScrollCollector;
    private keyboardCollector: KeyboardCollector;
    private depthCollector: DepthCollector;
    private densityCollector: DensityCollector;
    private waitCollector: WaitCollector;

    constructor() {
        this.clickCollector = new ClickCollector();
        this.scrollCollector = new ScrollCollector();
        this.keyboardCollector = new KeyboardCollector();
        this.depthCollector = new DepthCollector();
        this.densityCollector = new DensityCollector();
        this.waitCollector = new WaitCollector();

        // When a click is captured, also notify keyboard collector (for context switch tracking)
        // and density collector (to sample at interaction time)
        this.clickCollector.onClickCaptured = () => {
            this.keyboardCollector.notifyMouseAction();
            this.densityCollector.sampleOnInteraction();
        };

        // When scrolling, sample density (throttled internally by DensityCollector)
        this.scrollCollector.onScrollCaptured = () => {
            this.densityCollector.sampleOnScroll();
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
        console.log('UXBench: Recording started');

        this.addOverlay();

        this.clickCollector.attach();
        this.scrollCollector.attach();
        this.keyboardCollector.attach();
        this.depthCollector.attach();
        this.densityCollector.attach();
        this.waitCollector.attach();
    }

    private stop() {
        if (!this.isRecording) return;
        this.isRecording = false;
        console.log('UXBench: Recording stopped');

        this.removeOverlay();

        this.clickCollector.detach();
        this.scrollCollector.detach();
        this.keyboardCollector.detach();
        this.depthCollector.detach();
        this.densityCollector.detach();
        this.waitCollector.detach();
    }

    private addOverlay() {
        const div = document.createElement('div');
        div.id = 'uxbench-overlay';
        div.style.cssText = OVERLAY_CSS;
        div.textContent = 'REC \u25cf';
        document.body.appendChild(div);
    }

    private removeOverlay() {
        const div = document.getElementById('uxbench-overlay');
        if (div) div.remove();
    }
}

new Collector();
