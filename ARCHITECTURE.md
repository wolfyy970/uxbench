# UX Bench Architecture

## 1. Repository Structure

```
uxbench/
├── schema/
│   ├── task-payload.schema.json   # Task payload JSON Schema
│   └── examples/                  # Example payloads
│
├── recorder/
│   ├── manifest.json              # Chrome harness manifest
│   ├── build.js                   # Builds harness + library bundles
│   ├── src/
│   │   ├── core/                  # Pure metric engine, task lifecycle, payload types
│   │   ├── browser/               # DOM instrumentation adapter
│   │   ├── library/               # Public embedded API
│   │   ├── content/               # Chrome content-script harness adapter
│   │   ├── background/            # Chrome lifecycle/storage/message adapter
│   │   ├── sidepanel/             # Harness UI + report export
│   │   └── __mocks__/             # Chrome API stubs for vitest
│   └── package.json
│
└── Makefile
```

---

## 2. Boundaries

### Core

`src/core` has no DOM and no Chrome dependencies. It owns:

-   session and task-run lifecycle
-   multiple concurrent active task runs
-   event ingestion
-   per-task metric accumulation
-   task payload generation

All durations use a monotonic clock (`performance.now()` in production). Wall-clock dates are metadata only.

### Browser Instrumentation

`src/browser` owns DOM listeners and emits normalized metric events:

-   click geometry and explicit `standard | ceremonial | wasted` classification
-   scroll deltas
-   cursor movement deltas
-   input-mode and shortcut events

It does not aggregate metrics, call Chrome APIs, send network requests, or collect typed values or element text.

### Embedded Library

`src/library` exposes `createUxBench()`. It wires browser instrumentation to the core and returns task handles:

```ts
const task = uxbench.startTask("create-customer");
task.end({ status: "completed" });
```

Completed task payloads are delivered through `onTaskComplete`. The host application owns analytics transport.

### Chrome Harness

The harness keeps the existing side-panel workflow:

-   worker controls Start/Stop, tab injection, badge state, storage, and side-panel notifications
-   content script runs browser instrumentation plus the shared core during a recording
-   side panel subscribes to live snapshots and downloads task payloads

The side panel does not calculate metrics.

---

## 3. Data Contract

`schema/task-payload.schema.json` is the canonical schema for task payloads.

Current schema: `3.0`

Payloads contain:

-   source, app, session id, task id, task run id, status
-   wall-clock start/end timestamps
-   monotonic duration fields
-   quantitative task metrics
-   optional low-cardinality dimensions

Payloads intentionally exclude action logs, notes, typed values, element text, scores, attention claims, and inferred intent.

---

## 4. Build Outputs

`npm run build` in `recorder/` produces:

-   `dist/service-worker.js`
-   `dist/content-script.js`
-   `dist/sidepanel.js`
-   `dist/sidepanel.html`
-   `dist/uxbench.esm.js`
-   `dist/uxbench.iife.js`

---

## 5. Test Infrastructure

The recorder uses Vitest with `happy-dom`.

```bash
cd recorder && npm test
```

Coverage is organized around the architectural boundaries:

-   core task engine
-   browser instrumentation
-   embedded library API
-   Chrome worker adapter
-   side-panel report utilities
