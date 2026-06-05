# UX Bench — Product Specification

**Version:** 0.6
**Date:** June 4, 2026
**Status:** In Progress

---

## 1. What This Is

UX Bench measures the interaction workload of web applications.

It runs in two modes:

-   **Embedded library:** Web applications call `startTask()` / `endTask()` and receive analytics-ready task payloads through a callback.
-   **Chrome harness:** The browser side panel starts and stops a recording window for manual benchmarking, using the same metric core as the library.

---

## 2. Design Philosophy

Every design decision follows one principle: **the readout must be actionable to someone who has never heard of Fitts's Law.**

-   **Relatable**: Plain language, no jargon.
-   **Comparative**: Numbers only matter relative to something else.
-   **Diagnostic**: Names the specific element, interaction, or layout decision that's causing the cost.

---

## 3. Embedded Library

The library is callback-first. It does not send data over the network; the host application owns analytics delivery, retries, auth, consent, and batching.

```ts
const uxbench = createUxBench({
    app: "acme-crm",
    sessionId: "optional-session-id",
    dimensions: { release: "2026.06", variant: "A" },
    onTaskComplete: (payload) => {
        // host app sends payload to analytics
    },
});

const task = uxbench.startTask("create-customer", {
    dimensions: { route: "/customers/new" },
});

task.end({ status: "completed" });
```

Multiple named task runs may be active concurrently. Every observed browser event during an active task window is attributed to each active task run.

See [LIBRARY_GUIDE.md](./LIBRARY_GUIDE.md) for the complete embedded API lifecycle, destroy behavior, pagehide handling, and payload privacy rules.

---

## 4. Chrome Harness

### 4.1 User Flow

1.  Open Side Panel (auto-selects Tablet viewport — ready to record immediately).
2.  (Optional) Change **Viewport Size** via dropdown.
3.  Click **Start ⌘⇧R** (or press `Ctrl+Shift+R` / `Cmd+Shift+R`).
4.  Perform task — observe **Live Telemetry** updating in real-time.
5.  Click **Stop**.
6.  (Optional) Repeat for multi-run averaging.
7.  Click **Download** — native save dialog lets you name the file.

### 4.1.1 Live Telemetry (Side Panel)

The side panel is designed for **peripheral-vision monitoring** — the researcher watches the participant, not the panel. Eight metrics are displayed live via event-driven updates from the worker, organized by category:

| Group             | Metric            | Purpose                                                   |
| ----------------- | ----------------- | --------------------------------------------------------- |
| Temporal          | **Time**          | Elapsed time since recording started                      |
|                   | **Idle Gaps**     | Pauses > 3s between user actions                          |
| Click & Targeting | **Clicks**        | Total click count, including ceremonial and wasted clicks |
|                   | **Target Effort** | Fitts' Law Index of Difficulty — effort to reach targets  |
| Movement          | **Cursor**        | Total cursor travel distance — raw motor cost             |
| Navigation        | **Scroll**        | Scroll distance in pixels                                 |
|                   | **Switches**      | Mouse/keyboard context switches                           |
| Input             | **Shortcuts**     | Modifier-key combos used (Ctrl/Cmd/Alt + key)             |

Hover any metric label for a tooltip explaining what it measures. An **Activity Feed** timeline shows every captured event in real time, with a prominent **null state** showing the current run number and explaining the multi-run averaging workflow.

### 4.2 Metrics Captured

UX Bench captures quantitative task metrics only.

> **Detailed Metric Definitions**: See [RESEARCHER.md](./RESEARCHER.md) for the complete scientific breakdown of how these are measured and calculated.

**Core Metrics:**

1.  **Time on Task**: Total, active, idle, idle gap count.
2.  **Click Count**: Total, ceremonial, wasted.
3.  **Target Effort**: Fitts Index of Difficulty.
4.  **Scroll Distance**: Page, container, horizontal, total.
5.  **Cursor Travel**: Total pointer distance and movement samples.
6.  **Context Switches**: Mouse/keyboard transitions and longest streaks.
7.  **Shortcut Usage**: Modifier-key combos.

---

## 5. Build Plan (See ARCHITECTURE.md for Technical Details)

### Completed

-   Schema and Recorder foundations.
-   Shared quantitative metric core.
-   Browser instrumentation adapter.
-   Embedded callback-first library with ESM and IIFE bundles.
-   Chrome harness powered by the same shared core.
-   Multi-run averaging across all metric groups.
-   Vitest test suite covering core, browser instrumentation, library API, worker adapter, side panel utilities, and report export logic.
-   Welford directional Fitts's Law (approach-angle-aware target width).
-   Mouse travel tracking for total cursor distance.
-   Event queue serialization (prevents race conditions in rapid event handling).
-   Event-driven side panel with activity feed timeline (all 8 metrics live, idle gap detection).
-   Cohesive design system (alpha scale, brand orange accent, semantic tokens).
-   Native save dialog for downloads (`chrome.downloads` API).
-   Programmatic content script injection (covers pre-existing tabs).
-   Flush-before-finalize stop lifecycle, so trailing keyboard, scroll, and cursor metrics are included in the saved report.
-   Original-tab stop tracking, so recording stops in the tab where it started even if focus changes.
-   Per-run collector resets, so repeated runs in the same tab do not inherit previous run metrics.

### Remaining

-   Release polish.

---

## 6. Success Criteria

1.  Recorder works with a single shortcut.
2.  Library supports multiple concurrent task runs.
3.  Metrics are quantitative, analytics-ready, and free of vanity/inferred fields.
