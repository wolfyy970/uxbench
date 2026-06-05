export type UxBenchSource = "browser-library" | "chrome-extension";

export type TaskStatus = "completed" | "failed" | "cancelled" | "abandoned";

export type ClickClassification = "standard" | "ceremonial" | "wasted";

export type InputMode = "mouse" | "keyboard";

export type Dimensions = Record<string, string | number | boolean | null>;

export interface Clock {
    now(): number;
    date(): Date;
}

export interface RectSize {
    width: number;
    height: number;
}

export interface ClickEvent {
    type: "click";
    timestamp?: number;
    x: number;
    y: number;
    classification: ClickClassification;
    target: {
        tagName: string;
        id?: string;
        rect: RectSize;
    };
}

export interface ScrollEvent {
    type: "scroll";
    timestamp?: number;
    delta_px: number;
    page_delta_px: number;
    container_delta_px: number;
    horizontal_delta_px: number;
}

export interface CursorEvent {
    type: "cursor";
    timestamp?: number;
    delta_px: number;
    move_events: number;
}

export interface InputEvent {
    type: "input";
    timestamp?: number;
    mode: InputMode;
    shortcut?: boolean;
}

export type MetricEvent = ClickEvent | ScrollEvent | CursorEvent | InputEvent;

export interface TaskPayload {
    schema_version: "3.0";
    source: UxBenchSource;
    app: string;
    session_id: string;
    task_id: string;
    task_run_id: string;
    status: TaskStatus;
    started_at: string;
    ended_at: string;
    duration_ms: number;
    total_ms: number;
    active_ms: number;
    idle_ms: number;
    idle_gap_count: number;
    dimensions: Dimensions;
    metrics: TaskMetrics;
    run_count?: number;
    averaged?: boolean;
}

export interface TaskMetrics {
    clicks: {
        total: number;
        ceremonial: number;
        wasted: number;
    };
    target_effort: {
        average_id: number;
        max_id: number;
        max_distance_px: number;
        max_target_width_px: number;
    };
    scroll: {
        total_px: number;
        page_px: number;
        container_px: number;
        horizontal_px: number;
    };
    cursor: {
        total_px: number;
        move_events: number;
    };
    input: {
        context_switches: number;
        longest_keyboard_streak: number;
        longest_mouse_streak: number;
        shortcuts_used: number;
    };
}

export interface TaskSnapshot {
    task_id: string;
    task_run_id: string;
    elapsed_ms: number;
    total_ms: number;
    active_ms: number;
    idle_ms: number;
    idle_gap_count: number;
    metrics: TaskMetrics;
}

export interface StartTaskOptions {
    dimensions?: Dimensions;
}

export interface EndTaskOptions {
    status?: TaskStatus;
}

export interface TaskHandle {
    taskId: string;
    taskRunId: string;
    end(options?: EndTaskOptions): TaskPayload;
    fail(): TaskPayload;
    cancel(): TaskPayload;
    snapshot(): TaskSnapshot;
}

export interface MetricEngineOptions {
    app: string;
    source: UxBenchSource;
    sessionId?: string;
    idleThresholdMs?: number;
    dimensions?: Dimensions;
    clock?: Clock;
    onTaskComplete?: (payload: TaskPayload) => void;
    onError?: (error: unknown) => void;
}
