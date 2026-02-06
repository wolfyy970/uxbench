// Selectors for ceremonial UI elements (cookie banners, consent dialogs, etc.)
// Intentionally narrow — avoid [class*="banner"] and [class*="notice"] which match hero banners and notifications.
const CEREMONIAL_SELECTORS = [
    '[class*="cookie"]', '[class*="consent"]', '[class*="gdpr"]', '[class*="privacy"]',
    '[id*="cookie"]', '[id*="consent"]', '[id*="gdpr"]', '[id*="privacy"]',
    '[class*="cookie-banner"]', '[class*="consent-banner"]',
    '[data-testid*="cookie"]', '[data-testid*="consent"]',
].join(', ');

const CEREMONIAL_TEXT = ['accept', 'accept all', 'got it', 'i agree', 'dismiss', 'decline', 'reject', 'ok'];

import { NOOP } from './shared';

/** Clicks on the same target within this window are classified as "rapid re-click" (wasted) */
const RAPID_RECLICK_MS = 300;

/** Shape of the click event data sent to the background worker */
interface ClickEventData {
    type: 'click';
    timestamp: number;
    target: {
        tagName: string;
        id: string;
        className: string;
        innerText: string;
        rect: DOMRect;
    };
    x: number;
    y: number;
    classification: string;
    classificationReason?: string;
}

export class ClickCollector {
    private handler = (e: MouseEvent) => this.handleClick(e);
    private lastClickTime = 0;
    private lastClickTarget: EventTarget | null = null;

    // Callback for cross-collector coordination (context switches, density sampling)
    onClickCaptured: ((target: HTMLElement) => void) | null = null;

    attach() {
        document.addEventListener('click', this.handler, { capture: true, passive: true });
    }

    detach() {
        document.removeEventListener('click', this.handler, { capture: true });
    }

    private classifyClick(target: HTMLElement, _e: MouseEvent): { classification: string; reason: string } {
        // Wasted: disabled elements
        if (target.hasAttribute('disabled') || target.getAttribute('aria-disabled') === 'true') {
            return { classification: 'wasted', reason: 'disabled element' };
        }

        // Wasted: rapid re-click on same element (<300ms)
        // Exception: editable elements where double-click selects text (intentional)
        const now = Date.now();
        if (this.lastClickTarget === target && (now - this.lastClickTime) < RAPID_RECLICK_MS) {
            const isEditable = target.isContentEditable ||
                target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement;
            if (!isEditable) {
                return { classification: 'wasted', reason: 'rapid re-click' };
            }
        }

        // Ceremonial: cookie/consent/GDPR banners
        try {
            if (target.closest(CEREMONIAL_SELECTORS)) {
                return { classification: 'ceremonial', reason: 'consent/cookie banner' };
            }
        } catch { /* invalid selector on some pages */ }

        // Ceremonial: common dismiss text
        const text = (target.innerText || '').toLowerCase().trim();
        if (CEREMONIAL_TEXT.includes(text)) {
            // Only if inside a banner-like container or modal
            const parent = target.closest('[role="dialog"], [role="alertdialog"], .modal, [class*="banner"], [class*="overlay"]');
            if (parent) {
                return { classification: 'ceremonial', reason: 'dismiss/accept in overlay' };
            }
        }

        return { classification: 'productive', reason: '' };
    }

    private handleClick(e: MouseEvent) {
        const target = e.target as HTMLElement;
        const { classification, reason } = this.classifyClick(target, e);

        const eventData: ClickEventData = {
            type: 'click',
            timestamp: Date.now(),
            target: {
                tagName: target.tagName,
                id: target.id,
                className: typeof target.className === 'string' ? target.className : '',
                innerText: target.innerText?.substring(0, 50) || '',
                rect: target.getBoundingClientRect()
            },
            x: e.clientX,
            y: e.clientY,
            classification
        };

        if (reason) {
            eventData.classificationReason = reason;
        }

        this.lastClickTime = Date.now();
        this.lastClickTarget = target;

        chrome.runtime.sendMessage({
            type: 'EVENT_CAPTURED',
            payload: eventData
        }).catch(NOOP);

        // Notify other collectors (context switches, density sampling)
        if (this.onClickCaptured) this.onClickCaptured(target);
    }
}
