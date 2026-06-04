import { formatDuration, round2, formatCompact, getPath, setPath } from "./utils";

export interface DetailEntry {
    element: string;
    reason: string;
}
export interface IdleGap {
    gap_ms: number;
    after_action: string;
    before_action: string;
}
export interface FittsEntry {
    element: string;
    id: number;
    distance_px: number;
    target_size: string;
}
export interface ActionLogEntry {
    type: string;
    timestamp: number;
    target: string;
    text: string;
    classification: string;
}

export interface BenchmarkReport {
    schema_version: string;
    source: string;
    metadata: Record<string, unknown>;
    metrics: {
        click_count: {
            total: number;
            productive: number;
            ceremonial: number;
            wasted: number;
            ceremonial_details: DetailEntry[];
            wasted_details: DetailEntry[];
        };
        time_on_task: {
            total_ms: number;
            idle_gaps: IdleGap[];
            idle_ms?: number;
            active_ms?: number;
            longest_idle_ms?: number;
            longest_idle_after?: string;
        };
        fitts: {
            formula: string;
            cumulative_id: number;
            average_id: number;
            max_id: number;
            max_id_element: string;
            max_id_distance_px: number;
            max_id_target_size: string;
            top_3_hardest: FittsEntry[];
        };
        context_switches: {
            total: number;
            ratio: number;
            longest_keyboard_streak?: number;
            longest_mouse_streak?: number;
        };
        shortcut_coverage: {
            shortcuts_used: number;
        };
        typing_ratio: {
            free_text_inputs: number;
            constrained_inputs: number;
            ratio: number;
            free_text_fields: string[];
        };
        scanning_distance: {
            method: string;
            cumulative_px: number;
            average_px: number;
            max_single_px: number;
            max_single_from?: string;
            max_single_to?: string;
        };
        scroll_distance: {
            total_px: number;
            page_scroll_px?: number;
            container_scroll_px?: number;
            total_horizontal_px?: number;
            scroll_events?: number;
            heaviest_container?: string;
        };
        mouse_travel: {
            total_px: number;
            idle_travel_px: number;
            move_events: number;
            path_efficiency: number | null;
        };
    };
    action_log: ActionLogEntry[];
}

interface AvgField {
    path: string;
    round: (v: number) => number;
    defaultVal?: number;
}

const AVG_FIELDS: AvgField[] = [
    { path: "click_count.total", round: Math.round },
    { path: "click_count.productive", round: Math.round },
    { path: "click_count.ceremonial", round: Math.round },
    { path: "click_count.wasted", round: Math.round },
    { path: "time_on_task.total_ms", round: Math.round },
    { path: "fitts.cumulative_id", round: round2 },
    { path: "fitts.average_id", round: round2 },
    { path: "scanning_distance.cumulative_px", round: Math.round },
    { path: "scanning_distance.average_px", round: Math.round },
    { path: "scroll_distance.total_px", round: Math.round },
    { path: "scroll_distance.page_scroll_px", round: Math.round },
    { path: "scroll_distance.container_scroll_px", round: Math.round },
    { path: "scroll_distance.scroll_events", round: Math.round },
    { path: "context_switches.total", round: Math.round },
    { path: "context_switches.ratio", round: round2 },
    { path: "shortcut_coverage.shortcuts_used", round: Math.round },
    { path: "typing_ratio.free_text_inputs", round: Math.round },
    { path: "typing_ratio.constrained_inputs", round: Math.round },
    { path: "typing_ratio.ratio", round: round2 },
    { path: "mouse_travel.total_px", round: Math.round },
    { path: "mouse_travel.idle_travel_px", round: Math.round },
    { path: "mouse_travel.move_events", round: Math.round },
    { path: "mouse_travel.path_efficiency", round: round2 },
];

export function buildAveragedReport(runs: BenchmarkReport[]): BenchmarkReport {
    const validRuns = runs.filter(
        (run) => run && run.metrics && run.metrics.click_count && typeof run.metrics.click_count.total === "number",
    );
    if (validRuns.length === 0) throw new Error("No valid runs");

    const baseReport = JSON.parse(JSON.stringify(validRuns[validRuns.length - 1])) as BenchmarkReport;
    const count = validRuns.length;

    const sums = new Map<string, number>();
    for (const field of AVG_FIELDS) sums.set(field.path, 0);

    validRuns.forEach((run) => {
        for (const field of AVG_FIELDS) {
            sums.set(
                field.path,
                (sums.get(field.path) || 0) + (getPath(run.metrics, field.path) || field.defaultVal || 0),
            );
        }
    });

    for (const field of AVG_FIELDS) {
        setPath(baseReport.metrics, field.path, field.round((sums.get(field.path) || 0) / count));
    }

    const allHardest: FittsEntry[] = [];
    validRuns.forEach((run) => {
        if (run.metrics?.fitts?.top_3_hardest) allHardest.push(...run.metrics.fitts.top_3_hardest);
    });
    allHardest.sort((a, b) => b.id - a.id);
    baseReport.metrics.fitts.top_3_hardest = allHardest.slice(0, 3);

    const allFields = new Set<string>();
    validRuns.forEach((run) => {
        (run.metrics?.typing_ratio?.free_text_fields || []).forEach((f: string) => allFields.add(f));
    });
    baseReport.metrics.typing_ratio.free_text_fields = [...allFields];

    const bestMaxIdRun = validRuns.reduce((best, run) =>
        (run.metrics.fitts.max_id || 0) > (best.metrics.fitts.max_id || 0) ? run : best,
    );
    baseReport.metrics.fitts.max_id = round2(bestMaxIdRun.metrics.fitts.max_id || 0);
    baseReport.metrics.fitts.max_id_element = bestMaxIdRun.metrics.fitts.max_id_element || "";
    baseReport.metrics.fitts.max_id_distance_px = Math.round(bestMaxIdRun.metrics.fitts.max_id_distance_px || 0);
    baseReport.metrics.fitts.max_id_target_size = bestMaxIdRun.metrics.fitts.max_id_target_size || "";

    const bestScanRun = validRuns.reduce((best, run) =>
        (run.metrics.scanning_distance.max_single_px || 0) > (best.metrics.scanning_distance.max_single_px || 0)
            ? run
            : best,
    );
    baseReport.metrics.scanning_distance.max_single_px = Math.round(
        bestScanRun.metrics.scanning_distance.max_single_px || 0,
    );
    baseReport.metrics.scanning_distance.max_single_from = bestScanRun.metrics.scanning_distance.max_single_from || "";
    baseReport.metrics.scanning_distance.max_single_to = bestScanRun.metrics.scanning_distance.max_single_to || "";

    baseReport.metadata.run_count = count;
    baseReport.metadata.averaged = true;

    return baseReport;
}

export function generateMarkdownReport(report: BenchmarkReport): string {
    const m = report.metrics;
    const meta = report.metadata as Record<string, any>;
    const lines: string[] = [];

    lines.push("# UX Bench Report");
    lines.push("");
    const parts: string[] = [];
    if (meta.product) parts.push(`**Product:** ${meta.product}`);
    if (meta.task) parts.push(`**Task:** ${meta.task}`);
    if (m.time_on_task?.total_ms) parts.push(`**Duration:** ${formatDuration(m.time_on_task.total_ms)}`);
    if (meta.run_count > 1) parts.push(`**Runs:** ${meta.run_count} (averaged)`);
    if (parts.length > 0) lines.push(parts.join("  |  "));
    if (meta.url) lines.push(`**URL:** ${meta.url}`);
    lines.push(`**Date:** ${meta.timestamp ? new Date(meta.timestamp as string).toLocaleString() : "Unknown"}`);
    lines.push("");

    lines.push("## Metrics");
    lines.push("");
    lines.push("| Metric | Value | Detail |");
    lines.push("|--------|-------|--------|");

    const cc = m.click_count;
    lines.push(
        `| Clicks | ${cc.total} | ${cc.productive} productive, ${cc.ceremonial} ceremonial, ${cc.wasted} wasted |`,
    );
    lines.push(
        `| Fitts Avg ID | ${round2(m.fitts.average_id)} | max ${round2(m.fitts.max_id)} on "${m.fitts.max_id_element}" |`,
    );
    lines.push(
        `| Scanning Distance | ${Math.round(m.scanning_distance.average_px)}px avg | ${formatCompact(Math.round(m.scanning_distance.cumulative_px))}px total |`,
    );
    lines.push(
        `| Mouse Travel | ${formatCompact(Math.round(m.mouse_travel.total_px))}px | efficiency: ${m.mouse_travel.path_efficiency ?? "-"} |`,
    );
    lines.push(
        `| Scroll Distance | ${formatCompact(Math.round(m.scroll_distance.total_px))}px | ${m.scroll_distance.heaviest_container ? "heaviest: " + m.scroll_distance.heaviest_container : ""} |`,
    );
    lines.push(`| Context Switches | ${m.context_switches.total} | ratio: ${round2(m.context_switches.ratio)} |`);
    lines.push(`| Shortcuts Used | ${m.shortcut_coverage.shortcuts_used} | |`);

    const tr = m.typing_ratio;
    const typPct = tr.free_text_inputs + tr.constrained_inputs > 0 ? Math.round(tr.ratio * 100) + "%" : "-";
    lines.push(
        `| Typing Ratio | ${typPct} free-text | ${tr.free_text_inputs} free-text, ${tr.constrained_inputs} constrained |`,
    );
    lines.push("");

    if (m.fitts.top_3_hardest && m.fitts.top_3_hardest.length > 0) {
        lines.push("## Hardest Targets (Fitts)");
        lines.push("");
        m.fitts.top_3_hardest.forEach((t, i) => {
            lines.push(
                `${i + 1}. **${t.element}** - ID ${round2(t.id)}, ${Math.round(t.distance_px)}px away (${t.target_size})`,
            );
        });
        lines.push("");
    }

    if (cc.ceremonial_details && cc.ceremonial_details.length > 0) {
        lines.push("## Ceremonial Clicks");
        lines.push("");
        cc.ceremonial_details.forEach((d) => {
            lines.push(`- ${d.element}: ${d.reason}`);
        });
        lines.push("");
    }

    if (cc.wasted_details && cc.wasted_details.length > 0) {
        lines.push("## Wasted Clicks");
        lines.push("");
        cc.wasted_details.forEach((d) => {
            lines.push(`- ${d.element}: ${d.reason}`);
        });
        lines.push("");
    }

    if (tr.free_text_fields && tr.free_text_fields.length > 0) {
        lines.push("## Free-Text Fields");
        lines.push("");
        tr.free_text_fields.forEach((f) => lines.push(`- ${f}`));
        lines.push("");
    }

    const gaps = m.time_on_task.idle_gaps;
    if (gaps && gaps.length > 0) {
        lines.push("## Idle Gaps (> 3s)");
        lines.push("");
        gaps.forEach((g) => {
            lines.push(`- ${round2(g.gap_ms / 1000)}s after "${g.after_action}" -> before "${g.before_action}"`);
        });
        lines.push("");
    }

    lines.push("---");
    lines.push(`*Generated by UX Bench on ${new Date().toLocaleString()}*`);

    return lines.join("\n");
}
