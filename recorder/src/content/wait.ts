// Application wait detector — observes loading indicators (spinners, skeletons, progress bars)
// and reports cumulative wait time to the background worker.

const LOADING_QUERY = [
    '[class*="spinner"]', '[class*="loading"]', '[class*="skeleton"]',
    '[class*="progress"]', '[aria-busy="true"]', '[role="progressbar"]',
    '[class*="loader"]', '.shimmer', '[class*="placeholder"]',
].join(', ');

import { NOOP } from './shared';

/** Periodic check interval for CSS-only spinners that don't trigger DOM mutations */
const WAIT_CHECK_INTERVAL_MS = 500;

export class WaitCollector {
    private observer: MutationObserver | null = null;
    private waitStartTime: number | null = null;
    private totalWaitMs = 0;
    private checkInterval: ReturnType<typeof setInterval> | null = null;

    attach() {
        // Check if loading indicators are already visible
        this.checkLoadingState();

        // Observe DOM for loading indicator changes
        this.observer = new MutationObserver(() => {
            this.checkLoadingState();
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'aria-busy', 'style', 'hidden']
        });

        // Periodic check (some spinners are CSS-only, no DOM mutation)
        this.checkInterval = setInterval(() => this.checkLoadingState(), WAIT_CHECK_INTERVAL_MS);
    }

    detach() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        // Finalize any in-progress wait
        if (this.waitStartTime) {
            this.totalWaitMs += Date.now() - this.waitStartTime;
            this.waitStartTime = null;
        }
        this.sendUpdate();
    }

    private checkLoadingState() {
        const loadingElements = document.querySelectorAll(LOADING_QUERY);
        let hasVisible = false;

        for (const el of loadingElements) {
            const style = window.getComputedStyle(el);
            if (style.display !== 'none' && style.visibility !== 'hidden' &&
                parseFloat(style.opacity) > 0 &&
                el.getBoundingClientRect().width > 0) {
                hasVisible = true;
                break;
            }
        }

        if (hasVisible && !this.waitStartTime) {
            // Loading started
            this.waitStartTime = Date.now();
        } else if (!hasVisible && this.waitStartTime) {
            // Loading ended
            this.totalWaitMs += Date.now() - this.waitStartTime;
            this.waitStartTime = null;
            this.sendUpdate();
        }
    }

    private sendUpdate() {
        chrome.runtime.sendMessage({
            type: 'EVENT_CAPTURED',
            payload: {
                type: 'wait_update',
                application_wait_ms: this.totalWaitMs
            }
        }).catch(NOOP);
    }
}
