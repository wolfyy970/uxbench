// Mouse travel collector — rAF-sampled passive mousemove listener
// Tracks total cursor distance traveled across the session.
// Distinct from scanning distance (click-to-click) — this captures the actual path.

import { NOOP } from './shared';

export class MouseTravelCollector {
    private handler = (e: MouseEvent) => this.scheduleUpdate(e);
    private lastX = -1;
    private lastY = -1;
    private pendingX = -1;
    private pendingY = -1;
    private rafScheduled = false;
    private rafId = 0;

    private totalPx = 0;
    private moveEvents = 0;

    // Idle travel: distance since the last click. Reset on each click via notifyClick().
    private currentSegmentPx = 0;
    private idleTravelPx = 0;

    /** Throttle: minimum ms between messages to the worker */
    private static readonly SEND_THROTTLE_MS = 500;
    private lastSendTime = 0;

    attach() {
        document.addEventListener('mousemove', this.handler, { capture: true, passive: true });
    }

    detach() {
        document.removeEventListener('mousemove', this.handler, { capture: true });
        if (this.rafId) cancelAnimationFrame(this.rafId);
        // Process any pending position
        if (this.pendingX >= 0) this.processMove(this.pendingX, this.pendingY);
        this.flush();
    }

    /** Called by collector.ts when a click is captured — marks current segment as productive travel */
    notifyClick() {
        // The travel in the current segment ended with a click, so it's productive.
        // Reset the segment counter for the next inter-click period.
        this.currentSegmentPx = 0;
    }

    private scheduleUpdate(e: MouseEvent) {
        this.pendingX = e.clientX;
        this.pendingY = e.clientY;
        if (!this.rafScheduled) {
            this.rafScheduled = true;
            this.rafId = requestAnimationFrame(() => {
                this.rafScheduled = false;
                if (this.pendingX >= 0) {
                    this.processMove(this.pendingX, this.pendingY);
                }
            });
        }
    }

    private processMove(x: number, y: number) {
        if (this.lastX >= 0) {
            const dx = x - this.lastX;
            const dy = y - this.lastY;
            const delta = Math.sqrt(dx * dx + dy * dy);
            if (delta > 0) {
                this.totalPx += delta;
                this.currentSegmentPx += delta;
                this.moveEvents += 1;
                this.throttledSend();
            }
        } else {
            // First move event — just record position, no delta
            this.moveEvents += 1;
        }
        this.lastX = x;
        this.lastY = y;
    }

    private throttledSend() {
        const now = Date.now();
        if (now - this.lastSendTime >= MouseTravelCollector.SEND_THROTTLE_MS) {
            this.lastSendTime = now;
            this.sendUpdate();
        }
    }

    private sendUpdate() {
        // Idle travel = all previous segments that didn't end with a click + current in-progress segment
        const totalIdle = this.idleTravelPx + this.currentSegmentPx;

        chrome.runtime.sendMessage({
            type: 'EVENT_CAPTURED',
            payload: {
                type: 'mouse_travel_update',
                total_px: Math.round(this.totalPx),
                idle_travel_px: Math.round(totalIdle),
                move_events: this.moveEvents,
                path_efficiency: null  // computed by the worker from scanning_distance / total travel
            }
        }).catch(NOOP);
    }

    private flush() {
        // Finalize: current segment without a click is idle travel
        this.idleTravelPx += this.currentSegmentPx;
        this.currentSegmentPx = 0;
        if (this.totalPx > 0) {
            this.sendUpdate();
        }
    }
}
