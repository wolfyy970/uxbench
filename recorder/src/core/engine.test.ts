import { describe, expect, it, vi } from "vitest";
import { MetricEngine } from "./engine";
import type { Clock, MetricEvent, TaskPayload } from "./types";

function makeClock(): Clock & { advance(ms: number): void } {
    let now = 0;
    const start = Date.parse("2026-06-05T12:00:00.000Z");
    return {
        now: () => now,
        date: () => new Date(start + now),
        advance: (ms: number) => {
            now += ms;
        },
    };
}

const click = (x: number, y: number): MetricEvent => ({
    type: "click",
    x,
    y,
    classification: "standard",
    target: { tagName: "BUTTON", rect: { width: 40, height: 20 } },
});

describe("MetricEngine", () => {
    it("attributes the same event window to multiple concurrent tasks", () => {
        const clock = makeClock();
        const engine = new MetricEngine({ app: "app", source: "browser-library", clock });
        const first = engine.startTask("checkout");
        const second = engine.startTask("promo-panel");

        engine.ingest(click(0, 0));
        engine.ingest({
            type: "scroll",
            delta_px: 100,
            page_delta_px: 100,
            container_delta_px: 0,
            horizontal_delta_px: 0,
        });

        expect(first.snapshot().metrics.clicks.total).toBe(1);
        expect(second.snapshot().metrics.clicks.total).toBe(1);
        expect(first.snapshot().metrics.scroll.total_px).toBe(100);
        expect(second.snapshot().metrics.scroll.total_px).toBe(100);
    });

    it("allows repeated task ids by assigning unique task run ids", () => {
        const clock = makeClock();
        const engine = new MetricEngine({ app: "app", source: "browser-library", clock });
        const first = engine.startTask("create-customer");
        const second = engine.startTask("create-customer");

        expect(first.taskRunId).not.toBe(second.taskRunId);
        expect(first.taskId).toBe("create-customer");
        expect(second.taskId).toBe("create-customer");
    });

    it("ends only the requested task run", () => {
        const clock = makeClock();
        const completed: TaskPayload[] = [];
        const engine = new MetricEngine({
            app: "app",
            source: "browser-library",
            clock,
            onTaskComplete: (payload) => completed.push(payload),
        });
        const first = engine.startTask("a");
        const second = engine.startTask("b");

        first.end();

        expect(completed).toHaveLength(1);
        expect(completed[0].task_run_id).toBe(first.taskRunId);
        expect(() => second.snapshot()).not.toThrow();
    });

    it("throws a clear error for unknown task runs", () => {
        const engine = new MetricEngine({ app: "app", source: "browser-library", clock: makeClock() });
        expect(() => engine.endTask("missing")).toThrow("Unknown active task run");
    });

    it("tracks idle gaps per task", () => {
        const clock = makeClock();
        const engine = new MetricEngine({ app: "app", source: "browser-library", clock, idleThresholdMs: 3000 });
        const task = engine.startTask("task");

        engine.ingest(click(0, 0));
        clock.advance(3500);
        engine.ingest(click(100, 0));

        const payload = task.end();
        expect(payload.idle_gap_count).toBe(1);
        expect(payload.idle_ms).toBe(3500);
    });

    it("keeps Fitts state per task and excludes first click", () => {
        const clock = makeClock();
        const engine = new MetricEngine({ app: "app", source: "browser-library", clock });
        const task = engine.startTask("task");

        engine.ingest(click(0, 0));
        expect(task.snapshot().metrics.target_effort.average_id).toBe(0);

        engine.ingest(click(400, 0));
        const effort = task.snapshot().metrics.target_effort;
        expect(effort.average_id).toBeCloseTo(Math.log2(400 / 40 + 1), 2);
        expect(effort.max_distance_px).toBe(400);
        expect(effort.max_target_width_px).toBe(40);
    });

    it("abandons all active tasks", () => {
        const clock = makeClock();
        const engine = new MetricEngine({ app: "app", source: "browser-library", clock });
        engine.startTask("a");
        engine.startTask("b");

        const payloads = engine.abandonAll();

        expect(payloads.map((payload) => payload.status)).toEqual(["abandoned", "abandoned"]);
        expect(engine.hasActiveTasks()).toBe(false);
    });

    it("routes callback errors to onError", () => {
        const clock = makeClock();
        const onError = vi.fn();
        const engine = new MetricEngine({
            app: "app",
            source: "browser-library",
            clock,
            onTaskComplete: () => {
                throw new Error("consumer failed");
            },
            onError,
        });

        engine.startTask("task").end();

        expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
});
