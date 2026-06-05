import type {
    Clock,
    Dimensions,
    EndTaskOptions,
    InputMode,
    MetricEngineOptions,
    MetricEvent,
    RectSize,
    StartTaskOptions,
    TaskHandle,
    TaskMetrics,
    TaskPayload,
    TaskSnapshot,
    TaskStatus,
    UxBenchSource,
} from "./types";

const DEFAULT_IDLE_THRESHOLD_MS = 3000;

const browserClock: Clock = {
    now: () => performance.now(),
    date: () => new Date(),
};

let idCounter = 0;

function createSessionId(): string {
    return `uxb_${Date.now().toString(36)}_${(++idCounter).toString(36)}`;
}

function createTaskRunId(taskId: string): string {
    const safeTask = taskId.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 64) || "task";
    return `${safeTask}_${Date.now().toString(36)}_${(++idCounter).toString(36)}`;
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

function emptyMetrics(): TaskMetrics {
    return {
        clicks: { total: 0, ceremonial: 0, wasted: 0 },
        target_effort: {
            average_id: 0,
            max_id: 0,
            max_distance_px: 0,
            max_target_width_px: 0,
        },
        scroll: { total_px: 0, page_px: 0, container_px: 0, horizontal_px: 0 },
        cursor: { total_px: 0, move_events: 0 },
        input: {
            context_switches: 0,
            longest_keyboard_streak: 0,
            longest_mouse_streak: 0,
            shortcuts_used: 0,
        },
    };
}

function cloneMetrics(metrics: TaskMetrics): TaskMetrics {
    return JSON.parse(JSON.stringify(metrics)) as TaskMetrics;
}

class TaskRunAccumulator {
    private readonly metrics = emptyMetrics();
    private readonly startedAt: number;
    private readonly startedWall: string;
    private readonly dimensions: Dimensions;
    private lastUserActionAt: number;
    private idleMs = 0;
    private idleGapCount = 0;
    private lastClickPosition: { x: number; y: number } | null = null;
    private fittsMovementCount = 0;
    private fittsCumulativeId = 0;
    private lastInputMode: InputMode | null = null;
    private currentKeyboardStreak = 0;
    private currentMouseStreak = 0;

    constructor(
        private readonly taskId: string,
        private readonly taskRunId: string,
        private readonly app: string,
        private readonly source: UxBenchSource,
        private readonly sessionId: string,
        baseDimensions: Dimensions,
        taskDimensions: Dimensions,
        private readonly idleThresholdMs: number,
        private readonly clock: Clock,
    ) {
        this.startedAt = clock.now();
        this.startedWall = clock.date().toISOString();
        this.lastUserActionAt = this.startedAt;
        this.dimensions = { ...baseDimensions, ...taskDimensions };
    }

    ingest(event: MetricEvent) {
        switch (event.type) {
            case "click":
                this.recordUserAction(event.timestamp);
                this.metrics.clicks.total += 1;
                if (event.classification === "ceremonial") this.metrics.clicks.ceremonial += 1;
                if (event.classification === "wasted") this.metrics.clicks.wasted += 1;
                this.computeFitts(event.x, event.y, event.target.rect);
                this.recordInputMode("mouse", event.timestamp);
                break;
            case "scroll":
                this.recordUserAction(event.timestamp);
                this.metrics.scroll.total_px += event.delta_px;
                this.metrics.scroll.page_px += event.page_delta_px;
                this.metrics.scroll.container_px += event.container_delta_px;
                this.metrics.scroll.horizontal_px += event.horizontal_delta_px;
                break;
            case "cursor":
                this.metrics.cursor.total_px += event.delta_px;
                this.metrics.cursor.move_events += event.move_events;
                break;
            case "input":
                this.recordUserAction(event.timestamp);
                this.recordInputMode(event.mode, event.timestamp);
                if (event.shortcut) this.metrics.input.shortcuts_used += 1;
                break;
        }
    }

    snapshot(now = this.clock.now()): TaskSnapshot {
        const totalMs = Math.max(0, now - this.startedAt);
        return {
            task_id: this.taskId,
            task_run_id: this.taskRunId,
            elapsed_ms: Math.round(totalMs),
            total_ms: Math.round(totalMs),
            active_ms: Math.max(0, Math.round(totalMs - this.idleMs)),
            idle_ms: Math.round(this.idleMs),
            idle_gap_count: this.idleGapCount,
            metrics: cloneMetrics(this.metrics),
        };
    }

    complete(status: TaskStatus): TaskPayload {
        this.finalizeStreaks();
        const endedAt = this.clock.now();
        const snapshot = this.snapshot(endedAt);
        return {
            schema_version: "3.0",
            source: this.source,
            app: this.app,
            session_id: this.sessionId,
            task_id: this.taskId,
            task_run_id: this.taskRunId,
            status,
            started_at: this.startedWall,
            ended_at: this.clock.date().toISOString(),
            duration_ms: snapshot.total_ms,
            total_ms: snapshot.total_ms,
            active_ms: snapshot.active_ms,
            idle_ms: snapshot.idle_ms,
            idle_gap_count: snapshot.idle_gap_count,
            dimensions: { ...this.dimensions },
            metrics: snapshot.metrics,
        };
    }

    private recordUserAction(timestamp?: number) {
        const now = timestamp ?? this.clock.now();
        const gap = now - this.lastUserActionAt;
        if (gap > this.idleThresholdMs) {
            this.idleMs += gap;
            this.idleGapCount += 1;
        }
        this.lastUserActionAt = now;
    }

    private computeFitts(x: number, y: number, rect: RectSize) {
        if (this.lastClickPosition) {
            const dx = x - this.lastClickPosition.x;
            const dy = y - this.lastClickPosition.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(Math.abs(dy), Math.abs(dx));
            const targetWidth = rect.width * Math.abs(Math.cos(angle)) + rect.height * Math.abs(Math.sin(angle));
            if (distance > 0 && targetWidth > 0) {
                const id = Math.log2(distance / targetWidth + 1);
                this.fittsMovementCount += 1;
                this.fittsCumulativeId += id;
                this.metrics.target_effort.average_id = round2(this.fittsCumulativeId / this.fittsMovementCount);
                if (id > this.metrics.target_effort.max_id) {
                    this.metrics.target_effort.max_id = round2(id);
                    this.metrics.target_effort.max_distance_px = Math.round(distance);
                    this.metrics.target_effort.max_target_width_px = Math.round(targetWidth);
                }
            }
        }
        this.lastClickPosition = { x, y };
    }

    private recordInputMode(mode: InputMode, timestamp?: number) {
        if (timestamp !== undefined) this.lastUserActionAt = timestamp;
        if (this.lastInputMode && this.lastInputMode !== mode) {
            this.metrics.input.context_switches += 1;
            if (this.lastInputMode === "keyboard") {
                this.metrics.input.longest_keyboard_streak = Math.max(
                    this.metrics.input.longest_keyboard_streak,
                    this.currentKeyboardStreak,
                );
                this.currentKeyboardStreak = 0;
            } else {
                this.metrics.input.longest_mouse_streak = Math.max(
                    this.metrics.input.longest_mouse_streak,
                    this.currentMouseStreak,
                );
                this.currentMouseStreak = 0;
            }
        }

        if (mode === "keyboard") {
            this.currentKeyboardStreak += 1;
            this.metrics.input.longest_keyboard_streak = Math.max(
                this.metrics.input.longest_keyboard_streak,
                this.currentKeyboardStreak,
            );
        } else {
            this.currentMouseStreak += 1;
            this.metrics.input.longest_mouse_streak = Math.max(
                this.metrics.input.longest_mouse_streak,
                this.currentMouseStreak,
            );
        }
        this.lastInputMode = mode;
    }

    private finalizeStreaks() {
        this.metrics.input.longest_keyboard_streak = Math.max(
            this.metrics.input.longest_keyboard_streak,
            this.currentKeyboardStreak,
        );
        this.metrics.input.longest_mouse_streak = Math.max(
            this.metrics.input.longest_mouse_streak,
            this.currentMouseStreak,
        );
    }
}

export class MetricEngine {
    private readonly activeTasks = new Map<string, TaskRunAccumulator>();
    private readonly idleThresholdMs: number;
    private readonly sessionId: string;
    private readonly source: UxBenchSource;
    private readonly app: string;
    private readonly dimensions: Dimensions;
    private readonly clock: Clock;
    private readonly onTaskComplete?: (payload: TaskPayload) => void;
    private readonly onError?: (error: unknown) => void;

    constructor(options: MetricEngineOptions) {
        this.app = options.app;
        this.source = options.source;
        this.sessionId = options.sessionId || createSessionId();
        this.idleThresholdMs = options.idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS;
        this.dimensions = options.dimensions || {};
        this.clock = options.clock || browserClock;
        this.onTaskComplete = options.onTaskComplete;
        this.onError = options.onError;
    }

    startTask(taskId: string, options: StartTaskOptions = {}): TaskHandle {
        const taskRunId = createTaskRunId(taskId);
        const accumulator = new TaskRunAccumulator(
            taskId,
            taskRunId,
            this.app,
            this.source,
            this.sessionId,
            this.dimensions,
            options.dimensions || {},
            this.idleThresholdMs,
            this.clock,
        );
        this.activeTasks.set(taskRunId, accumulator);

        return {
            taskId,
            taskRunId,
            end: (endOptions?: EndTaskOptions) => this.endTask(taskRunId, endOptions),
            fail: () => this.endTask(taskRunId, { status: "failed" }),
            cancel: () => this.endTask(taskRunId, { status: "cancelled" }),
            snapshot: () => this.getSnapshot(taskRunId),
        };
    }

    ingest(event: MetricEvent) {
        for (const task of this.activeTasks.values()) {
            task.ingest(event);
        }
    }

    endTask(taskRunId: string, options: EndTaskOptions = {}): TaskPayload {
        const task = this.activeTasks.get(taskRunId);
        if (!task) throw new Error(`Unknown active task run: ${taskRunId}`);
        this.activeTasks.delete(taskRunId);
        const payload = task.complete(options.status || "completed");
        this.emitComplete(payload);
        return payload;
    }

    abandonAll(): TaskPayload[] {
        const taskRunIds = [...this.activeTasks.keys()];
        return taskRunIds.map((taskRunId) => this.endTask(taskRunId, { status: "abandoned" }));
    }

    hasActiveTasks(): boolean {
        return this.activeTasks.size > 0;
    }

    getSnapshot(taskRunId: string): TaskSnapshot {
        const task = this.activeTasks.get(taskRunId);
        if (!task) throw new Error(`Unknown active task run: ${taskRunId}`);
        return task.snapshot();
    }

    getSnapshots(): TaskSnapshot[] {
        return [...this.activeTasks.values()].map((task) => task.snapshot());
    }

    private emitComplete(payload: TaskPayload) {
        if (!this.onTaskComplete) return;
        try {
            this.onTaskComplete(payload);
        } catch (error) {
            if (this.onError) this.onError(error);
        }
    }
}
