// Scroll distance collector — rAF-sampled passive scroll listener
// Tracks both page-level and container-level scroll distances.

import { NOOP } from "./shared";

export class ScrollCollector {
    private readonly captureOpts: AddEventListenerOptions = { capture: true, passive: true };
    private pageHandler = () => this.scheduleUpdate("page");
    private lastPageY = 0;
    private lastPageX = 0;
    private lastContainerY: Map<EventTarget, number> = new Map();
    private lastContainerX: Map<EventTarget, number> = new Map();
    private pendingUpdate: "page" | "container" | null = null;
    private rafId = 0;
    private pendingContainers: Set<EventTarget> = new Set();
    private containerRafId = 0;

    private totalPx = 0;
    private pageScrollPx = 0;
    private containerScrollPx = 0;
    private totalHorizontalPx = 0;
    private scrollEvents = 0;
    private containerScrollMap: Map<EventTarget, { label: string; px: number }> = new Map();

    // Callback for cross-collector coordination
    onScrollCaptured: (() => void) | null = null;

    attach() {
        this.reset();
        this.lastPageY = window.scrollY;
        this.lastPageX = window.scrollX;
        // Passive listener on window for page scroll
        window.addEventListener("scroll", this.pageHandler, { passive: true });
        // Capture-phase listener catches scroll on any container element
        document.addEventListener("scroll", this.containerHandler, this.captureOpts);
    }

    async detach() {
        window.removeEventListener("scroll", this.pageHandler);
        document.removeEventListener("scroll", this.containerHandler, this.captureOpts);
        if (this.rafId) cancelAnimationFrame(this.rafId);
        if (this.pendingUpdate) {
            this.processPageScroll();
            this.pendingUpdate = null;
        }
        if (this.containerRafId) cancelAnimationFrame(this.containerRafId);
        this.processPendingContainers();
        await this.flush();
        this.reset();
    }

    // Arrow function to preserve `this`
    private containerHandler = (e: Event) => {
        if (e.target === document || e.target === document.documentElement) return;
        this.scheduleContainerUpdate(e.target!);
    };

    private scheduleUpdate(type: "page" | "container") {
        if (this.pendingUpdate) return; // already scheduled
        this.pendingUpdate = type;
        this.rafId = requestAnimationFrame(() => {
            this.processPageScroll();
            this.pendingUpdate = null;
        });
    }

    private scheduleContainerUpdate(target: EventTarget) {
        this.pendingContainers.add(target);
        if (this.containerRafId) return;

        this.containerRafId = requestAnimationFrame(() => {
            this.containerRafId = 0;
            this.processPendingContainers();
        });
    }

    private processPendingContainers() {
        const targets = [...this.pendingContainers];
        this.pendingContainers.clear();
        targets.forEach((target) => this.processContainerScroll(target));
    }

    private processPageScroll() {
        const currentY = window.scrollY;
        const currentX = window.scrollX;
        const deltaY = Math.abs(currentY - this.lastPageY);
        const deltaX = Math.abs(currentX - this.lastPageX);
        const delta = deltaY + deltaX;
        if (delta > 0) {
            this.pageScrollPx += delta;
            this.totalPx += delta;
            this.totalHorizontalPx += deltaX;
            this.scrollEvents += 1;
            this.lastPageY = currentY;
            this.lastPageX = currentX;
            this.sendUpdate();
            if (this.onScrollCaptured) this.onScrollCaptured();
        }
    }

    private processContainerScroll(target: EventTarget) {
        const el = target as HTMLElement;
        const currentY = el.scrollTop;
        const currentX = el.scrollLeft;

        // First time we see this container: record its current position as baseline.
        // Without this, a container already scrolled to e.g. scrollTop=500 would
        // falsely count that 500px as user-initiated scroll distance.
        if (!this.lastContainerY.has(target)) {
            this.lastContainerY.set(target, currentY);
            this.lastContainerX.set(target, currentX);
            return;
        }

        const lastY = this.lastContainerY.get(target)!;
        const lastX = this.lastContainerX.get(target)!;
        const deltaY = Math.abs(currentY - lastY);
        const deltaX = Math.abs(currentX - lastX);
        const delta = deltaY + deltaX;

        if (delta > 0) {
            this.containerScrollPx += delta;
            this.totalPx += delta;
            this.totalHorizontalPx += deltaX;
            this.scrollEvents += 1;
            this.lastContainerY.set(target, currentY);
            this.lastContainerX.set(target, currentX);

            // Track per-container totals for "heaviest_container" (keyed by element reference)
            const label = el.id || el.className?.split(" ")[0] || el.tagName;
            const existing = this.containerScrollMap.get(target);
            if (existing) {
                existing.px += delta;
            } else {
                this.containerScrollMap.set(target, { label, px: delta });
            }

            this.sendUpdate();
            if (this.onScrollCaptured) this.onScrollCaptured();
        }
    }

    private async sendUpdate() {
        // Find heaviest container
        let heaviest = "";
        let heaviestPx = 0;
        for (const { label, px } of this.containerScrollMap.values()) {
            if (px > heaviestPx) {
                heaviest = label;
                heaviestPx = px;
            }
        }

        await chrome.runtime
            .sendMessage({
                type: "EVENT_CAPTURED",
                payload: {
                    type: "scroll_update",
                    total_px: this.totalPx,
                    page_scroll_px: this.pageScrollPx,
                    container_scroll_px: this.containerScrollPx,
                    total_horizontal_px: this.totalHorizontalPx,
                    scroll_events: this.scrollEvents,
                    heaviest_container: heaviest || null,
                },
            })
            .catch(NOOP);
    }

    private async flush() {
        if (this.totalPx > 0) {
            await this.sendUpdate();
        }
    }

    private reset() {
        this.totalPx = 0;
        this.pageScrollPx = 0;
        this.containerScrollPx = 0;
        this.totalHorizontalPx = 0;
        this.scrollEvents = 0;
        this.pendingUpdate = null;
        this.rafId = 0;
        this.pendingContainers.clear();
        this.containerRafId = 0;
        this.containerScrollMap.clear();
        this.lastContainerY.clear();
        this.lastContainerX.clear();
    }
}
