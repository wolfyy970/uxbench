# UX Bench Library Guide

UX Bench can be embedded in a web application to measure quantitative task workload. The library records browser interaction deltas, attributes them to active task windows, and returns analytics-ready task payloads through a callback.

The library does not send network requests. Host applications own consent, sampling, auth, batching, retries, and delivery.

---

## API

```ts
import { createUxBench } from "./recorder/dist/uxbench.esm.js";

const uxbench = createUxBench({
    app: "acme-crm",
    sessionId: "optional-session-id",
    idleThresholdMs: 3000,
    dimensions: { release: "2026.06", variant: "A" },
    onTaskComplete: (payload) => {
        navigator.sendBeacon("/analytics/uxbench", JSON.stringify(payload));
    },
    onError: (error) => {
        console.error(error);
    },
});

const task = uxbench.startTask("create-customer", {
    dimensions: { route: "/customers/new" },
});

task.end({ status: "completed" });
```

`createUxBench()` starts browser instrumentation immediately. Use one client per browser session or application shell.

---

## Task Lifecycle

`startTask(taskId, options?)` returns a task handle with:

-   `taskId`: caller-provided task name
-   `taskRunId`: unique run identifier
-   `end(options?)`: completes the run
-   `fail()`: completes the run with `failed`
-   `cancel()`: completes the run with `cancelled`
-   `snapshot()`: returns current metrics for the active run

The client also exposes `endTask(taskRunId, options?)` for callers that store run IDs instead of handles.

Supported statuses are:

-   `completed`
-   `failed`
-   `cancelled`
-   `abandoned`

`pagehide` abandons every active task. This lets the completion callback use `sendBeacon` during page unload when the host application wants to preserve partial task data.

`destroy()` removes browser listeners and abandons active tasks once. Calling `destroy()` more than once is safe. After destroy, `startTask()` and `endTask()` throw `UX Bench client destroyed`, `ingest()` is ignored, and `getSnapshots()` returns an empty array.

---

## Multiple Tasks

Multiple task runs may be active at the same time, including repeated runs with the same `taskId`. `taskRunId` is the unique active-run key.

Every observed event is attributed to every active task window. This is useful for nested or overlapping workflows, but broad task windows can inflate metrics. Keep task windows as tight as the product question allows.

---

## Dimensions

Use `dimensions` for low-cardinality labels such as release, route, variant, plan, or cohort.

Do not put personal data, typed values, element text, selectors, or high-cardinality entity IDs in dimensions.

---

## Payload Privacy

Completed task payloads contain quantitative metrics only:

-   time totals and idle gap counts
-   click totals and explicit ceremonial/wasted buckets
-   target effort statistics
-   scroll distance
-   cursor distance
-   input-mode switches, streaks, and shortcut counts

Payloads intentionally exclude action logs, notes, typed values, element text, selectors, transient target IDs, screenshots, scores, attention claims, and inferred intent.
