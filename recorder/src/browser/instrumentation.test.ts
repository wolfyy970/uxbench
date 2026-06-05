import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserInstrumentation } from "./instrumentation";
import type { MetricEvent } from "../core";

let rafCallbacks: FrameRequestCallback[] = [];

function flushRaf() {
    const callbacks = rafCallbacks.splice(0);
    callbacks.forEach((callback) => callback(performance.now()));
}

function setScroll(x: number, y: number) {
    Object.defineProperty(window, "scrollX", { configurable: true, value: x });
    Object.defineProperty(window, "scrollY", { configurable: true, value: y });
}

describe("createBrowserInstrumentation", () => {
    const events: MetricEvent[] = [];
    let originalRaf: typeof requestAnimationFrame;
    let originalCancelRaf: typeof cancelAnimationFrame;

    beforeEach(() => {
        events.length = 0;
        document.body.innerHTML = "";
        rafCallbacks = [];
        originalRaf = globalThis.requestAnimationFrame;
        originalCancelRaf = globalThis.cancelAnimationFrame;
        globalThis.requestAnimationFrame = vi.fn((callback) => {
            rafCallbacks.push(callback);
            return rafCallbacks.length;
        }) as any;
        globalThis.cancelAnimationFrame = vi.fn();
        setScroll(0, 0);
    });

    afterEach(() => {
        globalThis.requestAnimationFrame = originalRaf;
        globalThis.cancelAnimationFrame = originalCancelRaf;
    });

    it("emits sanitized click geometry without element text", () => {
        const instrumentation = createBrowserInstrumentation({ emit: (event) => events.push(event) });
        instrumentation.start();

        const button = document.createElement("button");
        button.id = "save";
        button.textContent = "Sensitive customer name";
        document.body.appendChild(button);
        button.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 20 }));

        expect(events[0]).toMatchObject({
            type: "click",
            x: 10,
            y: 20,
            classification: "standard",
            target: { tagName: "BUTTON", id: "save" },
        });
        expect(JSON.stringify(events[0])).not.toContain("Sensitive customer name");

        instrumentation.destroy();
    });

    it("emits keyboard input events without typed values", () => {
        const instrumentation = createBrowserInstrumentation({ emit: (event) => events.push(event) });
        instrumentation.start();

        document.dispatchEvent(new KeyboardEvent("keydown", { key: "A", bubbles: true, metaKey: true }));

        expect(events[0]).toMatchObject({ type: "input", mode: "keyboard", shortcut: true });
        expect(JSON.stringify(events[0])).not.toContain("A");

        instrumentation.destroy();
    });

    it("emits page scroll deltas", () => {
        const instrumentation = createBrowserInstrumentation({ emit: (event) => events.push(event) });
        instrumentation.start();

        setScroll(0, 150);
        window.dispatchEvent(new Event("scroll"));
        flushRaf();

        expect(events[0]).toMatchObject({
            type: "scroll",
            delta_px: 150,
            page_delta_px: 150,
            container_delta_px: 0,
            horizontal_delta_px: 0,
        });

        instrumentation.destroy();
    });

    it("emits cursor movement deltas and resets between sessions", () => {
        const instrumentation = createBrowserInstrumentation({ emit: (event) => events.push(event) });
        instrumentation.start();
        document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 0, clientY: 0 }));
        flushRaf();
        document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 30, clientY: 40 }));
        flushRaf();

        expect(events.at(-1)).toMatchObject({ type: "cursor", delta_px: 50, move_events: 1 });

        instrumentation.destroy();
        events.length = 0;

        instrumentation.start();
        document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 100, clientY: 100 }));
        flushRaf();
        instrumentation.flush();

        expect(events).toHaveLength(0);
        instrumentation.destroy();
    });

    it("removes listeners on destroy", () => {
        const instrumentation = createBrowserInstrumentation({ emit: (event) => events.push(event) });
        instrumentation.start();
        instrumentation.destroy();

        document.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));

        expect(events).toHaveLength(0);
    });
});
