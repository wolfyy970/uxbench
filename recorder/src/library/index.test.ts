import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUxBench } from "./index";
import type { TaskPayload } from "../core";

let rafCallbacks: FrameRequestCallback[] = [];

function flushRaf() {
    const callbacks = rafCallbacks.splice(0);
    callbacks.forEach((callback) => callback(performance.now()));
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
    if (!value || typeof value !== "object") {
        return keys;
    }

    if (Array.isArray(value)) {
        value.forEach((entry) => collectKeys(entry, keys));
        return keys;
    }

    Object.entries(value).forEach(([key, entry]) => {
        keys.add(key);
        collectKeys(entry, keys);
    });
    return keys;
}

describe("createUxBench", () => {
    let originalRaf: typeof requestAnimationFrame;
    let originalCancelRaf: typeof cancelAnimationFrame;

    beforeEach(() => {
        document.body.innerHTML = "";
        rafCallbacks = [];
        originalRaf = globalThis.requestAnimationFrame;
        originalCancelRaf = globalThis.cancelAnimationFrame;
        globalThis.requestAnimationFrame = vi.fn((callback) => {
            rafCallbacks.push(callback);
            return rafCallbacks.length;
        }) as any;
        globalThis.cancelAnimationFrame = vi.fn();
    });

    afterEach(() => {
        globalThis.requestAnimationFrame = originalRaf;
        globalThis.cancelAnimationFrame = originalCancelRaf;
    });

    it("calls onTaskComplete when a task ends", () => {
        const completed: TaskPayload[] = [];
        const client = createUxBench({
            app: "acme",
            sessionId: "session-1",
            onTaskComplete: (payload) => completed.push(payload),
        });

        const task = client.startTask("create-customer");
        client.ingest({
            type: "click",
            x: 0,
            y: 0,
            classification: "standard",
            target: { tagName: "BUTTON", rect: { width: 80, height: 32 } },
        });
        task.end();

        expect(completed).toHaveLength(1);
        expect(completed[0]).toMatchObject({
            schema_version: "3.0",
            source: "browser-library",
            app: "acme",
            session_id: "session-1",
            task_id: "create-customer",
            status: "completed",
            metrics: { clicks: { total: 1 } },
        });

        client.destroy();
    });

    it("routes consumer callback errors to onError", () => {
        const onError = vi.fn();
        const client = createUxBench({
            app: "acme",
            onTaskComplete: () => {
                throw new Error("analytics failed");
            },
            onError,
        });

        client.startTask("task").end();

        expect(onError).toHaveBeenCalledWith(expect.any(Error));
        client.destroy();
    });

    it("abandons active tasks on destroy", () => {
        const completed: TaskPayload[] = [];
        const client = createUxBench({
            app: "acme",
            onTaskComplete: (payload) => completed.push(payload),
        });

        client.startTask("task");
        client.destroy();

        expect(completed[0].status).toBe("abandoned");
    });

    it("abandons active tasks on pagehide", () => {
        const completed: TaskPayload[] = [];
        const client = createUxBench({
            app: "acme",
            onTaskComplete: (payload) => completed.push(payload),
        });

        const task = client.startTask("checkout");
        window.dispatchEvent(new Event("pagehide"));

        expect(completed).toHaveLength(1);
        expect(completed[0]).toMatchObject({
            task_run_id: task.taskRunId,
            status: "abandoned",
        });

        client.destroy();
    });

    it("lets multiple active tasks end in different orders", () => {
        const completed: TaskPayload[] = [];
        const client = createUxBench({
            app: "acme",
            onTaskComplete: (payload) => completed.push(payload),
        });

        const first = client.startTask("duplicate-task");
        const second = client.startTask("duplicate-task");
        client.ingest({
            type: "click",
            x: 12,
            y: 18,
            classification: "ceremonial",
            target: { tagName: "BUTTON", rect: { width: 80, height: 32 } },
        });

        second.cancel();
        first.end();

        expect(first.taskRunId).not.toBe(second.taskRunId);
        expect(completed.map((payload) => payload.task_run_id)).toEqual([second.taskRunId, first.taskRunId]);
        expect(completed.map((payload) => payload.status)).toEqual(["cancelled", "completed"]);
        expect(completed.map((payload) => payload.metrics.clicks.ceremonial)).toEqual([1, 1]);

        client.destroy();
    });

    it("does not duplicate abandoned payloads on repeated destroy", () => {
        const completed: TaskPayload[] = [];
        const client = createUxBench({
            app: "acme",
            onTaskComplete: (payload) => completed.push(payload),
        });

        client.startTask("task");
        client.destroy();
        client.destroy();

        expect(completed).toHaveLength(1);
        expect(completed[0].status).toBe("abandoned");
    });

    it("throws a clear client destroyed error after destroy", () => {
        const client = createUxBench({
            app: "acme",
            onTaskComplete: vi.fn(),
        });
        const task = client.startTask("task");

        client.destroy();

        expect(() => client.startTask("late-task")).toThrow("UX Bench client destroyed");
        expect(() => client.endTask(task.taskRunId)).toThrow("UX Bench client destroyed");
        expect(() => task.end()).toThrow("UX Bench client destroyed");
        expect(() => task.fail()).toThrow("UX Bench client destroyed");
        expect(() => task.cancel()).toThrow("UX Bench client destroyed");
        expect(() => task.snapshot()).toThrow("UX Bench client destroyed");
    });

    it("ignores ingest and returns empty snapshots after destroy", () => {
        const completed: TaskPayload[] = [];
        const client = createUxBench({
            app: "acme",
            onTaskComplete: (payload) => completed.push(payload),
        });

        client.startTask("task");
        client.destroy();

        expect(() =>
            client.ingest({
                type: "click",
                x: 0,
                y: 0,
                classification: "wasted",
                target: { tagName: "BUTTON", rect: { width: 80, height: 32 } },
            }),
        ).not.toThrow();
        expect(client.getSnapshots()).toEqual([]);
        expect(completed).toHaveLength(1);
        expect(completed[0].metrics.clicks.wasted).toBe(0);
    });

    it("keeps completed payloads free of transient targets, typed values, selectors, notes, and removed fields", () => {
        const completed: TaskPayload[] = [];
        const client = createUxBench({
            app: "acme",
            dimensions: { release: "2026.06", variant: "A" },
            onTaskComplete: (payload) => completed.push(payload),
        });

        const task = client.startTask("privacy-check", {
            dimensions: { route: "/customers/new" },
        });
        client.ingest({
            type: "click",
            x: 24,
            y: 36,
            classification: "standard",
            target: {
                tagName: "BUTTON",
                id: "secret-target-id",
                rect: { width: 88, height: 40 },
            },
        });
        client.ingest({
            type: "input",
            mode: "keyboard",
            shortcut: true,
        });
        task.end();

        const payload = completed[0];
        const payloadText = JSON.stringify(payload);
        const keys = collectKeys(payload);

        expect(keys).not.toContain("action_log");
        expect(keys).not.toContain("target");
        expect(keys).not.toContain("id");
        expect(keys).not.toContain("text");
        expect(keys).not.toContain("selector");
        expect(keys).not.toContain("notes");
        expect(payloadText).not.toContain("secret-target-id");
        expect(payloadText).not.toContain("SensitiveKey");
        expect(payloadText).not.toContain("#secret-target-id");
        expect(payloadText).not.toContain("typing_ratio");
        expect(payloadText).not.toContain("scanning_distance");
        expect(payloadText).not.toContain("path_efficiency");
        expect(payloadText).not.toContain("human_signals");
        expect(payload.metrics.input.shortcuts_used).toBe(1);

        client.destroy();
    });

    it("removes browser listeners on destroy", () => {
        const completed: TaskPayload[] = [];
        const client = createUxBench({
            app: "acme",
            onTaskComplete: (payload) => completed.push(payload),
        });
        const task = client.startTask("task");

        client.destroy();
        document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 0, clientY: 0 }));
        flushRaf();

        expect(completed[0].task_run_id).toBe(task.taskRunId);
        expect(completed[0].metrics.cursor.total_px).toBe(0);
    });
});
