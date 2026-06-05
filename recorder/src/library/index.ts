import { createBrowserInstrumentation, type BrowserInstrumentation } from "../browser/instrumentation";
import { MetricEngine } from "../core";
import type {
    Dimensions,
    EndTaskOptions,
    MetricEvent,
    StartTaskOptions,
    TaskHandle,
    TaskPayload,
    TaskSnapshot,
} from "../core";

export interface CreateUxBenchOptions {
    app: string;
    sessionId?: string;
    idleThresholdMs?: number;
    dimensions?: Dimensions;
    onTaskComplete: (payload: TaskPayload) => void;
    onError?: (error: unknown) => void;
}

export interface UxBenchClient {
    startTask(taskId: string, options?: StartTaskOptions): TaskHandle;
    endTask(taskRunId: string, options?: EndTaskOptions): TaskPayload;
    ingest(event: MetricEvent): void;
    getSnapshots(): TaskSnapshot[];
    destroy(): void;
}

const CLIENT_DESTROYED_MESSAGE = "UX Bench client destroyed";

export function createUxBench(options: CreateUxBenchOptions): UxBenchClient {
    const engine = new MetricEngine({
        app: options.app,
        source: "browser-library",
        sessionId: options.sessionId,
        idleThresholdMs: options.idleThresholdMs,
        dimensions: options.dimensions,
        onTaskComplete: options.onTaskComplete,
        onError: options.onError,
    });

    let destroyed = false;

    const instrumentation: BrowserInstrumentation = createBrowserInstrumentation({
        emit: (event) => {
            if (!destroyed) {
                engine.ingest(event);
            }
        },
    });
    instrumentation.start();

    const assertActiveClient = () => {
        if (destroyed) {
            throw new Error(CLIENT_DESTROYED_MESSAGE);
        }
    };

    const wrapTaskHandle = (handle: TaskHandle): TaskHandle => ({
        taskId: handle.taskId,
        taskRunId: handle.taskRunId,
        end: (endOptions) => {
            assertActiveClient();
            return engine.endTask(handle.taskRunId, endOptions);
        },
        fail: () => {
            assertActiveClient();
            return engine.endTask(handle.taskRunId, { status: "failed" });
        },
        cancel: () => {
            assertActiveClient();
            return engine.endTask(handle.taskRunId, { status: "cancelled" });
        },
        snapshot: () => {
            assertActiveClient();
            return engine.getSnapshot(handle.taskRunId);
        },
    });

    const abandonOnPageHide = () => {
        engine.abandonAll();
    };
    window.addEventListener("pagehide", abandonOnPageHide, { once: true });

    return {
        startTask: (taskId, taskOptions) => {
            assertActiveClient();
            return wrapTaskHandle(engine.startTask(taskId, taskOptions));
        },
        endTask: (taskRunId, endOptions) => {
            assertActiveClient();
            return engine.endTask(taskRunId, endOptions);
        },
        ingest: (event) => {
            if (!destroyed) {
                engine.ingest(event);
            }
        },
        getSnapshots: () => (destroyed ? [] : engine.getSnapshots()),
        destroy: () => {
            if (destroyed) {
                return;
            }
            destroyed = true;
            window.removeEventListener("pagehide", abandonOnPageHide);
            instrumentation.destroy();
            engine.abandonAll();
        },
    };
}

export type {
    Dimensions,
    EndTaskOptions,
    MetricEvent,
    StartTaskOptions,
    TaskHandle,
    TaskPayload,
    TaskSnapshot,
} from "../core";
