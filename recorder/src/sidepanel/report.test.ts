import { describe, expect, it } from "vitest";
import { buildAveragedReport, generateMarkdownReport, type BenchmarkReport } from "./report";

function makePayload(partial: Partial<BenchmarkReport> = {}): BenchmarkReport {
    const base: BenchmarkReport = {
        schema_version: "3.0",
        source: "chrome-extension",
        app: "UX Bench Harness",
        session_id: "session",
        task_id: "harness-recording",
        task_run_id: "run",
        status: "completed",
        started_at: "2026-06-05T12:00:00.000Z",
        ended_at: "2026-06-05T12:00:05.000Z",
        duration_ms: 1000,
        total_ms: 1000,
        active_ms: 1000,
        idle_ms: 0,
        idle_gap_count: 0,
        dimensions: {},
        metrics: {
            clicks: { total: 0, ceremonial: 0, wasted: 0 },
            target_effort: { average_id: 0, max_id: 0, max_distance_px: 0, max_target_width_px: 0 },
            scroll: { total_px: 0, page_px: 0, container_px: 0, horizontal_px: 0 },
            cursor: { total_px: 0, move_events: 0 },
            input: {
                context_switches: 0,
                longest_keyboard_streak: 0,
                longest_mouse_streak: 0,
                shortcuts_used: 0,
            },
        },
    };

    return {
        ...base,
        ...partial,
        metrics: { ...base.metrics, ...partial.metrics },
    };
}

describe("buildAveragedReport", () => {
    it("averages repeatable fields and keeps max target effort fields from the worst run", () => {
        const averaged = buildAveragedReport([
            makePayload({
                duration_ms: 1000,
                total_ms: 1000,
                metrics: {
                    clicks: { total: 2, ceremonial: 0, wasted: 0 },
                    target_effort: { average_id: 2, max_id: 8.25, max_distance_px: 940, max_target_width_px: 12 },
                    scroll: { total_px: 100, page_px: 100, container_px: 0, horizontal_px: 0 },
                    cursor: { total_px: 300, move_events: 10 },
                    input: {
                        context_switches: 1,
                        longest_keyboard_streak: 2,
                        longest_mouse_streak: 3,
                        shortcuts_used: 0,
                    },
                },
            }),
            makePayload({
                duration_ms: 3000,
                total_ms: 3000,
                metrics: {
                    clicks: { total: 6, ceremonial: 2, wasted: 0 },
                    target_effort: { average_id: 10, max_id: 3.1, max_distance_px: 200, max_target_width_px: 160 },
                    scroll: { total_px: 300, page_px: 200, container_px: 100, horizontal_px: 0 },
                    cursor: { total_px: 900, move_events: 30 },
                    input: {
                        context_switches: 3,
                        longest_keyboard_streak: 4,
                        longest_mouse_streak: 5,
                        shortcuts_used: 2,
                    },
                },
            }),
        ]);

        expect(averaged.duration_ms).toBe(2000);
        expect(averaged.metrics.clicks.total).toBe(4);
        expect(averaged.metrics.target_effort.average_id).toBe(6);
        expect(averaged.metrics.target_effort.max_id).toBe(8.25);
        expect(averaged.metrics.target_effort.max_distance_px).toBe(940);
        expect(averaged.metrics.target_effort.max_target_width_px).toBe(12);
        expect(averaged.run_count).toBe(2);
        expect(averaged.averaged).toBe(true);
    });

    it("generates quantitative-only Markdown", () => {
        const markdown = generateMarkdownReport(
            makePayload({
                metrics: {
                    clicks: { total: 3, ceremonial: 1, wasted: 1 },
                    target_effort: { average_id: 2, max_id: 3, max_distance_px: 240, max_target_width_px: 80 },
                    scroll: { total_px: 600, page_px: 400, container_px: 200, horizontal_px: 0 },
                    cursor: { total_px: 900, move_events: 30 },
                    input: {
                        context_switches: 2,
                        longest_keyboard_streak: 4,
                        longest_mouse_streak: 3,
                        shortcuts_used: 1,
                    },
                },
            }),
        );

        expect(markdown).toContain("| Clicks | 3 | 1 ceremonial, 1 wasted |");
        for (const removedClaim of ["Eye Travel", "Typing Ratio", "productive", "path efficiency", "notes"]) {
            expect(markdown).not.toContain(removedClaim);
        }
    });
});
