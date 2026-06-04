import { describe, expect, it } from "vitest";
import { buildAveragedReport, type BenchmarkReport } from "./report";

function makeRun(partial: Partial<BenchmarkReport>): BenchmarkReport {
    const base: BenchmarkReport = {
        schema_version: "1.0",
        source: "chrome-extension",
        metadata: {
            recording_name: "",
            product: "Product",
            task: "Task",
            timestamp: "2026-06-04T12:00:00.000Z",
            duration_ms: 1000,
        },
        metrics: {
            click_count: {
                total: 0,
                productive: 0,
                ceremonial: 0,
                wasted: 0,
                ceremonial_details: [],
                wasted_details: [],
            },
            time_on_task: { total_ms: 1000, idle_gaps: [] },
            fitts: {
                formula: "shannon",
                cumulative_id: 0,
                average_id: 0,
                max_id: 0,
                max_id_element: "",
                max_id_distance_px: 0,
                max_id_target_size: "",
                top_3_hardest: [],
            },
            context_switches: { total: 0, ratio: 0 },
            shortcut_coverage: { shortcuts_used: 0 },
            typing_ratio: {
                free_text_inputs: 0,
                constrained_inputs: 0,
                ratio: 0,
                free_text_fields: [],
            },
            scanning_distance: {
                method: "euclidean",
                cumulative_px: 0,
                average_px: 0,
                max_single_px: 0,
            },
            scroll_distance: { total_px: 0 },
            mouse_travel: {
                total_px: 0,
                idle_travel_px: 0,
                move_events: 0,
                path_efficiency: null,
            },
        },
        action_log: [],
    };

    return {
        ...base,
        ...partial,
        metadata: { ...base.metadata, ...partial.metadata },
        metrics: { ...base.metrics, ...partial.metrics },
    };
}

describe("buildAveragedReport", () => {
    it("keeps max fields from the run that actually produced the max value", () => {
        const averaged = buildAveragedReport([
            makeRun({
                metrics: {
                    fitts: {
                        formula: "shannon",
                        cumulative_id: 2,
                        average_id: 2,
                        max_id: 8.25,
                        max_id_element: "Tiny Save",
                        max_id_distance_px: 940,
                        max_id_target_size: "12x12px",
                        top_3_hardest: [{ element: "Tiny Save", id: 8.25, distance_px: 940, target_size: "12x12px" }],
                    },
                    scanning_distance: {
                        method: "euclidean",
                        cumulative_px: 200,
                        average_px: 200,
                        max_single_px: 1200,
                        max_single_from: "Header",
                        max_single_to: "Footer CTA",
                    },
                    click_count: {
                        total: 2,
                        productive: 2,
                        ceremonial: 0,
                        wasted: 0,
                        ceremonial_details: [],
                        wasted_details: [],
                    },
                    time_on_task: { total_ms: 1000, idle_gaps: [] },
                    context_switches: { total: 0, ratio: 0 },
                    shortcut_coverage: { shortcuts_used: 0 },
                    typing_ratio: { free_text_inputs: 0, constrained_inputs: 0, ratio: 0, free_text_fields: [] },
                    scroll_distance: { total_px: 0 },
                    mouse_travel: { total_px: 0, idle_travel_px: 0, move_events: 0, path_efficiency: null },
                },
            }),
            makeRun({
                metrics: {
                    fitts: {
                        formula: "shannon",
                        cumulative_id: 10,
                        average_id: 10,
                        max_id: 3.1,
                        max_id_element: "Large Button",
                        max_id_distance_px: 200,
                        max_id_target_size: "160x48px",
                        top_3_hardest: [
                            { element: "Large Button", id: 3.1, distance_px: 200, target_size: "160x48px" },
                        ],
                    },
                    scanning_distance: {
                        method: "euclidean",
                        cumulative_px: 800,
                        average_px: 800,
                        max_single_px: 400,
                        max_single_from: "Sidebar",
                        max_single_to: "Toolbar",
                    },
                    click_count: {
                        total: 6,
                        productive: 6,
                        ceremonial: 0,
                        wasted: 0,
                        ceremonial_details: [],
                        wasted_details: [],
                    },
                    time_on_task: { total_ms: 3000, idle_gaps: [] },
                    context_switches: { total: 0, ratio: 0 },
                    shortcut_coverage: { shortcuts_used: 0 },
                    typing_ratio: { free_text_inputs: 0, constrained_inputs: 0, ratio: 0, free_text_fields: [] },
                    scroll_distance: { total_px: 0 },
                    mouse_travel: { total_px: 0, idle_travel_px: 0, move_events: 0, path_efficiency: null },
                },
            }),
        ]);

        expect(averaged.metrics.click_count.total).toBe(4);
        expect(averaged.metrics.fitts.average_id).toBe(6);
        expect(averaged.metrics.fitts.max_id).toBe(8.25);
        expect(averaged.metrics.fitts.max_id_element).toBe("Tiny Save");
        expect(averaged.metrics.fitts.max_id_distance_px).toBe(940);
        expect(averaged.metrics.fitts.max_id_target_size).toBe("12x12px");
        expect(averaged.metrics.scanning_distance.max_single_px).toBe(1200);
        expect(averaged.metrics.scanning_distance.max_single_from).toBe("Header");
        expect(averaged.metrics.scanning_distance.max_single_to).toBe("Footer CTA");
    });
});
