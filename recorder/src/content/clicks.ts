// Selectors for ceremonial UI elements (cookie banners, consent dialogs, etc.)
// Intentionally narrow — avoid [class*="banner"] and [class*="notice"] which match hero banners and notifications.
const CEREMONIAL_SELECTORS = [
    '[class*="cookie"]', '[class*="consent"]', '[class*="gdpr"]', '[class*="privacy"]',
    '[id*="cookie"]', '[id*="consent"]', '[id*="gdpr"]', '[id*="privacy"]',
    '[class*="cookie-banner"]', '[class*="consent-banner"]',
    '[data-testid*="cookie"]', '[data-testid*="consent"]',
].join(', ');

// Elements the user perceives as a single clickable target.
// When e.target is a child (icon, span), we walk up to the nearest interactive ancestor
// so the bounding rect reflects the actual target (for Fitts) and disabled state is correct.
const INTERACTIVE_SELECTOR = 'a, button, [role="button"], [role="link"], [role="menuitem"], [role="tab"], input, select, textarea, summary';

import { NOOP } from './shared';

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

/**
 * Resolve the click target to the nearest interactive ancestor.
 * If e.target is an icon/span inside a button, this returns the button.
 * Falls back to the raw target when no interactive ancestor exists (e.g., plain text click).
 */
function resolveInteractiveTarget(raw: HTMLElement): HTMLElement {
    try {
        const interactive = raw.closest(INTERACTIVE_SELECTOR) as HTMLElement | null;
        return interactive || raw;
    } catch {
        return raw;
    }
}

export class ClickCollector {
    private handler = (e: MouseEvent) => this.handleClick(e);

    // Callback for cross-collector coordination (context switches, mouse travel)
    onClickCaptured: ((target: HTMLElement) => void) | null = null;

    attach() {
        document.addEventListener('click', this.handler, { capture: true, passive: true });
    }

    detach() {
        document.removeEventListener('click', this.handler, { capture: true });
    }

    private classifyClick(target: HTMLElement): { classification: string; reason: string } {
        // Wasted: disabled elements — walk up to catch disabled ancestors (e.g., icon inside disabled button)
        try {
            const disabled = target.closest('[disabled], [aria-disabled="true"]') as HTMLElement | null;
            if (disabled) {
                return { classification: 'wasted', reason: 'disabled element' };
            }
        } catch { /* invalid selector on some pages */ }

        // Ceremonial: cookie/consent/GDPR banners — interface overhead, not task work
        try {
            if (target.closest(CEREMONIAL_SELECTORS)) {
                return { classification: 'ceremonial', reason: 'consent/cookie banner' };
            }
        } catch { /* invalid selector on some pages */ }

        return { classification: 'productive', reason: '' };
    }

    private handleClick(e: MouseEvent) {
        const rawTarget = e.target as HTMLElement;
        // Resolve to the nearest interactive ancestor so the rect and metadata
        // reflect the actual clickable element, not a child icon/span.
        const target = resolveInteractiveTarget(rawTarget);
        const { classification, reason } = this.classifyClick(target);

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

        chrome.runtime.sendMessage({
            type: 'EVENT_CAPTURED',
            payload: eventData
        }).catch(NOOP);

        // Notify other collectors (context switches, mouse travel)
        if (this.onClickCaptured) this.onClickCaptured(rawTarget);
    }
}
