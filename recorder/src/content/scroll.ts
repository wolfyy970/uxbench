// Scroll distance collector — rAF-sampled passive scroll listener
// Tracks both page-level and container-level scroll distances.

export class ScrollCollector {
    private pageHandler = () => this.scheduleUpdate('page');
    private lastPageY = 0;
    private lastContainerY: Map<EventTarget, number> = new Map();
    private pendingUpdate: 'page' | 'container' | null = null;
    private rafId = 0;

    private totalPx = 0;
    private pageScrollPx = 0;
    private containerScrollPx = 0;
    private scrollEvents = 0;
    private containerScrollMap: Map<string, number> = new Map();

    attach() {
        this.lastPageY = window.scrollY;
        // Passive listener on window for page scroll
        window.addEventListener('scroll', this.pageHandler, { passive: true });
        // Capture-phase listener catches scroll on any container element
        document.addEventListener('scroll', this.containerHandler, { capture: true, passive: true });
    }

    detach() {
        window.removeEventListener('scroll', this.pageHandler);
        document.removeEventListener('scroll', this.containerHandler, { capture: true } as any);
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.flush();
    }

    // Arrow function to preserve `this`
    private containerHandler = (e: Event) => {
        if (e.target === document || e.target === document.documentElement) return;
        this.scheduleContainerUpdate(e.target!);
    };

    private scheduleUpdate(type: 'page' | 'container') {
        if (this.pendingUpdate) return; // already scheduled
        this.pendingUpdate = type;
        this.rafId = requestAnimationFrame(() => {
            this.processPageScroll();
            this.pendingUpdate = null;
        });
    }

    private scheduleContainerUpdate(target: EventTarget) {
        // Process immediately via rAF batching
        requestAnimationFrame(() => {
            this.processContainerScroll(target);
        });
    }

    private processPageScroll() {
        const currentY = window.scrollY;
        const delta = Math.abs(currentY - this.lastPageY);
        if (delta > 0) {
            this.pageScrollPx += delta;
            this.totalPx += delta;
            this.scrollEvents += 1;
            this.lastPageY = currentY;
            this.sendUpdate();
        }
    }

    private processContainerScroll(target: EventTarget) {
        const el = target as HTMLElement;
        const currentY = el.scrollTop;
        const lastY = this.lastContainerY.get(target) || 0;
        const delta = Math.abs(currentY - lastY);

        if (delta > 0) {
            this.containerScrollPx += delta;
            this.totalPx += delta;
            this.scrollEvents += 1;
            this.lastContainerY.set(target, currentY);

            // Track per-container totals for "heaviest_container"
            const identifier = el.id || el.className?.split(' ')[0] || el.tagName;
            const existing = this.containerScrollMap.get(identifier) || 0;
            this.containerScrollMap.set(identifier, existing + delta);

            this.sendUpdate();
        }
    }

    private sendUpdate() {
        // Find heaviest container
        let heaviest = '';
        let heaviestPx = 0;
        for (const [id, px] of this.containerScrollMap) {
            if (px > heaviestPx) {
                heaviest = id;
                heaviestPx = px;
            }
        }

        chrome.runtime.sendMessage({
            type: 'EVENT_CAPTURED',
            payload: {
                type: 'scroll_update',
                total_px: this.totalPx,
                page_scroll_px: this.pageScrollPx,
                container_scroll_px: this.containerScrollPx,
                scroll_events: this.scrollEvents,
                heaviest_container: heaviest || null
            }
        }).catch(() => {});
    }

    private flush() {
        if (this.totalPx > 0) {
            this.sendUpdate();
        }
        // Reset state
        this.totalPx = 0;
        this.pageScrollPx = 0;
        this.containerScrollPx = 0;
        this.scrollEvents = 0;
        this.containerScrollMap.clear();
        this.lastContainerY.clear();
    }
}
