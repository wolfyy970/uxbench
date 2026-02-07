/// <reference types="chrome"/>

import { ClickCollector } from './clicks';
import { ScrollCollector } from './scroll';
import { KeyboardCollector } from './keyboard';
import { MouseTravelCollector } from './mouse-travel';
import { BRAND_ORANGE } from './shared';
/** Max int32 — ensures overlay renders above all page content */
const Z_TOP = 2147483647;

/* Overlay is injected into the host page — cannot use our CSS custom properties.
 * Values mirror the design system: BRAND_ORANGE (--ds-orange), #EEEEEE (--ds-light),
 * rgba(0,0,0,0.2) (shadow), sans-serif (--font-family fallback). */
const OVERLAY_CSS = `
    position: fixed; bottom: 20px; right: 20px;
    background: ${BRAND_ORANGE}; color: #EEEEEE;
    padding: 8px 12px; border-radius: 4px;
    z-index: ${Z_TOP};
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    pointer-events: none;
`;

/** Throttle interval for counting wheel events as mouse actions for context switch tracking */
const WHEEL_MOUSE_ACTION_THROTTLE_MS = 300;

class Collector {
    private isRecording = false;
    private clickCollector: ClickCollector;
    private scrollCollector: ScrollCollector;
    private keyboardCollector: KeyboardCollector;
    private mouseTravelCollector: MouseTravelCollector;
    private lastWheelActionTime = 0;
    private wheelHandler = () => this.handleWheel();

    constructor() {
        this.clickCollector = new ClickCollector();
        this.scrollCollector = new ScrollCollector();
        this.keyboardCollector = new KeyboardCollector();
        this.mouseTravelCollector = new MouseTravelCollector();

        // When a click is captured, also notify keyboard collector (for context switch tracking)
        // and mouse travel (end of productive segment)
        this.clickCollector.onClickCaptured = () => {
            this.keyboardCollector.notifyMouseAction();
            this.mouseTravelCollector.notifyClick();
        };

        this.initListeners();
    }

    /** Wheel events are an unambiguous mouse action (keyboard-initiated scrolls don't fire wheel).
     *  Throttled so a single scroll gesture counts as one action rather than dozens. */
    private handleWheel() {
        const now = Date.now();
        if (now - this.lastWheelActionTime >= WHEEL_MOUSE_ACTION_THROTTLE_MS) {
            this.lastWheelActionTime = now;
            this.keyboardCollector.notifyMouseAction();
        }
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
        this.mouseTravelCollector.attach();
        // Wheel listener for context switch tracking (mouse wheel = mouse action)
        document.addEventListener('wheel', this.wheelHandler, { capture: true, passive: true });
    }

    private stop() {
        if (!this.isRecording) return;
        this.isRecording = false;
        console.log('UXBench: Recording stopped');

        this.removeOverlay();

        this.clickCollector.detach();
        this.scrollCollector.detach();
        this.keyboardCollector.detach();
        this.mouseTravelCollector.detach();
        document.removeEventListener('wheel', this.wheelHandler, { capture: true });
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

// Guard against double-initialization.
// The manifest injects this script on page load. The worker also injects it
// programmatically on startRecording() to cover tabs that pre-date the extension.
// Without this guard, duplicate Collector instances would attach duplicate listeners.
if (!(window as any).__uxbench_loaded) {
    (window as any).__uxbench_loaded = true;
    new Collector();
}
