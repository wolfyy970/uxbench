import type { ClickClassification, MetricEvent } from "../core";

const CEREMONIAL_SELECTORS = [
    '[class*="cookie"]',
    '[class*="consent"]',
    '[class*="gdpr"]',
    '[class*="privacy"]',
    '[id*="cookie"]',
    '[id*="consent"]',
    '[id*="gdpr"]',
    '[id*="privacy"]',
    '[data-testid*="cookie"]',
    '[data-testid*="consent"]',
].join(", ");

const INTERACTIVE_SELECTOR =
    'a, button, [role="button"], [role="link"], [role="menuitem"], [role="tab"], input, select, textarea, summary';

const WHEEL_MOUSE_ACTION_THROTTLE_MS = 300;

export interface BrowserInstrumentation {
    start(): void;
    flush(): void;
    destroy(): void;
}

export interface BrowserInstrumentationOptions {
    emit: (event: MetricEvent) => void;
}

export function createBrowserInstrumentation(options: BrowserInstrumentationOptions): BrowserInstrumentation {
    return new DomInstrumentation(options.emit);
}

function resolveInteractiveTarget(raw: HTMLElement): HTMLElement {
    try {
        return (raw.closest(INTERACTIVE_SELECTOR) as HTMLElement | null) || raw;
    } catch {
        return raw;
    }
}

function classifyClick(target: HTMLElement): { classification: ClickClassification } {
    try {
        if (target.closest('[disabled], [aria-disabled="true"]')) return { classification: "wasted" };
    } catch {
        // Ignore host-page selector failures.
    }

    try {
        if (target.closest(CEREMONIAL_SELECTORS)) return { classification: "ceremonial" };
    } catch {
        // Ignore host-page selector failures.
    }

    return { classification: "standard" };
}

function containerLabel(el: HTMLElement): string {
    return el.id || (typeof el.className === "string" ? el.className.split(" ")[0] : "") || el.tagName;
}

class DomInstrumentation implements BrowserInstrumentation {
    private active = false;
    private readonly captureOpts: AddEventListenerOptions = { capture: true, passive: true };
    private lastPageY = 0;
    private lastPageX = 0;
    private lastContainerY = new Map<EventTarget, number>();
    private lastContainerX = new Map<EventTarget, number>();
    private containerTotals = new Map<EventTarget, { label: string; px: number }>();
    private pendingPage = false;
    private pendingContainers = new Set<EventTarget>();
    private pageRafId = 0;
    private containerRafId = 0;
    private lastMouseX = -1;
    private lastMouseY = -1;
    private pendingMouseX = -1;
    private pendingMouseY = -1;
    private mouseRafId = 0;
    private lastWheelActionAt = 0;

    constructor(private readonly emit: (event: MetricEvent) => void) {}

    start() {
        if (this.active) return;
        this.active = true;
        this.reset();
        this.lastPageY = window.scrollY;
        this.lastPageX = window.scrollX;
        document.addEventListener("click", this.handleClick, this.captureOpts);
        document.addEventListener("keydown", this.handleKeydown, this.captureOpts);
        document.addEventListener("mousemove", this.handleMouseMove, this.captureOpts);
        document.addEventListener("scroll", this.handleContainerScroll, this.captureOpts);
        document.addEventListener("wheel", this.handleWheel, this.captureOpts);
        window.addEventListener("scroll", this.handlePageScroll, { passive: true });
    }

    flush() {
        if (this.pageRafId) {
            cancelAnimationFrame(this.pageRafId);
            this.pageRafId = 0;
        }
        if (this.pendingPage) this.processPageScroll();
        this.pendingPage = false;

        if (this.containerRafId) {
            cancelAnimationFrame(this.containerRafId);
            this.containerRafId = 0;
        }
        this.processPendingContainers();

        if (this.mouseRafId) {
            cancelAnimationFrame(this.mouseRafId);
            this.mouseRafId = 0;
        }
        if (this.pendingMouseX >= 0) this.processMouseMove(this.pendingMouseX, this.pendingMouseY);
        this.pendingMouseX = -1;
        this.pendingMouseY = -1;
    }

    destroy() {
        if (!this.active) return;
        this.flush();
        this.active = false;
        document.removeEventListener("click", this.handleClick, this.captureOpts);
        document.removeEventListener("keydown", this.handleKeydown, this.captureOpts);
        document.removeEventListener("mousemove", this.handleMouseMove, this.captureOpts);
        document.removeEventListener("scroll", this.handleContainerScroll, this.captureOpts);
        document.removeEventListener("wheel", this.handleWheel, this.captureOpts);
        window.removeEventListener("scroll", this.handlePageScroll);
        this.reset();
    }

    private handleClick = (event: MouseEvent) => {
        const rawTarget = event.target as HTMLElement | null;
        if (!rawTarget) return;
        const target = resolveInteractiveTarget(rawTarget);
        const rect = target.getBoundingClientRect();
        this.emit({
            type: "click",
            timestamp: performance.now(),
            x: event.clientX,
            y: event.clientY,
            classification: classifyClick(target).classification,
            target: {
                tagName: target.tagName,
                id: target.id || undefined,
                rect: { width: rect.width, height: rect.height },
            },
        });
    };

    private handleKeydown = (event: KeyboardEvent) => {
        if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
        this.emit({
            type: "input",
            timestamp: performance.now(),
            mode: "keyboard",
            shortcut: event.ctrlKey || event.metaKey || event.altKey,
        });
    };

    private handleWheel = () => {
        const now = performance.now();
        if (now - this.lastWheelActionAt < WHEEL_MOUSE_ACTION_THROTTLE_MS) return;
        this.lastWheelActionAt = now;
        this.emit({ type: "input", timestamp: now, mode: "mouse" });
    };

    private handlePageScroll = () => {
        if (this.pendingPage) return;
        this.pendingPage = true;
        this.pageRafId = requestAnimationFrame(() => {
            this.pageRafId = 0;
            this.processPageScroll();
            this.pendingPage = false;
        });
    };

    private handleContainerScroll = (event: Event) => {
        if (event.target === document || event.target === document.documentElement) return;
        this.pendingContainers.add(event.target!);
        if (this.containerRafId) return;
        this.containerRafId = requestAnimationFrame(() => {
            this.containerRafId = 0;
            this.processPendingContainers();
        });
    };

    private handleMouseMove = (event: MouseEvent) => {
        this.pendingMouseX = event.clientX;
        this.pendingMouseY = event.clientY;
        if (this.mouseRafId) return;
        this.mouseRafId = requestAnimationFrame(() => {
            this.mouseRafId = 0;
            if (this.pendingMouseX >= 0) this.processMouseMove(this.pendingMouseX, this.pendingMouseY);
        });
    };

    private processPageScroll() {
        const currentY = window.scrollY;
        const currentX = window.scrollX;
        const deltaY = Math.abs(currentY - this.lastPageY);
        const deltaX = Math.abs(currentX - this.lastPageX);
        const delta = deltaY + deltaX;
        if (delta > 0) {
            this.emit({
                type: "scroll",
                timestamp: performance.now(),
                delta_px: delta,
                page_delta_px: delta,
                container_delta_px: 0,
                horizontal_delta_px: deltaX,
            });
            this.lastPageY = currentY;
            this.lastPageX = currentX;
        }
    }

    private processPendingContainers() {
        const targets = [...this.pendingContainers];
        this.pendingContainers.clear();
        targets.forEach((target) => this.processContainerScroll(target));
    }

    private processContainerScroll(target: EventTarget) {
        const el = target as HTMLElement;
        const currentY = el.scrollTop;
        const currentX = el.scrollLeft;

        if (!this.lastContainerY.has(target)) {
            this.lastContainerY.set(target, currentY);
            this.lastContainerX.set(target, currentX);
            return;
        }

        const deltaY = Math.abs(currentY - this.lastContainerY.get(target)!);
        const deltaX = Math.abs(currentX - this.lastContainerX.get(target)!);
        const delta = deltaY + deltaX;
        if (delta > 0) {
            const existing = this.containerTotals.get(target);
            if (existing) existing.px += delta;
            else this.containerTotals.set(target, { label: containerLabel(el), px: delta });
            this.emit({
                type: "scroll",
                timestamp: performance.now(),
                delta_px: delta,
                page_delta_px: 0,
                container_delta_px: delta,
                horizontal_delta_px: deltaX,
            });
            this.lastContainerY.set(target, currentY);
            this.lastContainerX.set(target, currentX);
        }
    }

    private processMouseMove(x: number, y: number) {
        if (this.lastMouseX >= 0) {
            const dx = x - this.lastMouseX;
            const dy = y - this.lastMouseY;
            const delta = Math.sqrt(dx * dx + dy * dy);
            if (delta > 0) {
                this.emit({
                    type: "cursor",
                    timestamp: performance.now(),
                    delta_px: Math.round(delta),
                    move_events: 1,
                });
            }
        }
        this.lastMouseX = x;
        this.lastMouseY = y;
    }

    private reset() {
        this.lastPageY = 0;
        this.lastPageX = 0;
        this.lastContainerY.clear();
        this.lastContainerX.clear();
        this.containerTotals.clear();
        this.pendingPage = false;
        this.pendingContainers.clear();
        this.pageRafId = 0;
        this.containerRafId = 0;
        this.lastMouseX = -1;
        this.lastMouseY = -1;
        this.pendingMouseX = -1;
        this.pendingMouseY = -1;
        this.mouseRafId = 0;
        this.lastWheelActionAt = 0;
    }
}
