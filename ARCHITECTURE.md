# UX Bench Architecture

## 1. Repository Structure

```
uxbench/
├── schema/
│   ├── benchmark.schema.json      # JSON Schema (the contract)
│   └── examples/                  # Example JSON files for testing
│
├── recorder/                      # Chrome Extension (TypeScript)
│   ├── manifest.json
│   ├── src/
│   │   ├── background/
│   │   │   ├── worker.ts          # Service worker (state machine, event routing)
│   │   │   └── worker.test.ts
│   │   ├── content/
│   │   │   ├── collector.ts       # Orchestrator — wires all 4 collectors
│   │   │   ├── clicks.ts          # Click capture, target geometry
│   │   │   ├── scroll.ts          # Page + container scroll distance (vertical + horizontal)
│   │   │   ├── keyboard.ts        # Context switches, shortcuts, typing ratio
│   │   │   ├── mouse-travel.ts    # Cursor travel distance (rAF-sampled mousemove)
│   │   │   └── *.test.ts          # One test file per collector
│   │   ├── sidepanel/
│   │   │   ├── index.html         # Terminal-style HUD
│   │   │   ├── app.ts             # UI state, event-driven feed, download actions
│   │   │   ├── report.ts          # Pure report averaging + Markdown export logic
│   │   │   └── utils.ts           # Pure utility functions (formatting, path helpers)
│   │   └── __mocks__/setup.ts     # Chrome API stubs for vitest
│   ├── vitest.config.ts
│   └── package.json
│
└── Makefile                       # Build system
```

---

## 2. JSON Schema

The schema (`schema/benchmark.schema.json`) is the single source of truth for the benchmark report format.

### 2.1 Schema Definition Overview

Detailed schema structure is defined in `schema/benchmark.schema.json`. Key sections:

-   **Metadata**: Product, Task, Operator (human/agent), Source.
-   **Metrics**: The 9 core efficiency metrics.
-   **Human Signals**: Derived signals like hesitation and decision time.
-   **Action Log**: Optional per-action detail emitted by the recorder.

---

## 3. Extension Architecture (Recorder)

### 3.1 Manifest V3

Key permissions: `activeTab`, `sidePanel`, `storage`, `commands`, `scripting`, `downloads`.
No remote code. Fully offline.

### 3.2 Content Script — Collector Architecture

The content script uses a **Collector orchestrator** (`collector.ts`) that wires four independent collectors. Each collector owns one concern and communicates to the worker via `chrome.runtime.sendMessage`.

```
Collector (orchestrator)
├── ClickCollector        → click events            → EVENT_CAPTURED {type: "click"}
├── ScrollCollector       → page + container scroll  → EVENT_CAPTURED {type: "scroll_update"}
├── KeyboardCollector     → keys, focus, shortcuts   → EVENT_CAPTURED {type: "keyboard_update"}
└── MouseTravelCollector  → cursor distance (rAF)   → EVENT_CAPTURED {type: "mouse_travel_update"}
```

**Cross-collector coordination:** The orchestrator connects collectors via callbacks:

-   Click captured → `KeyboardCollector.notifyMouseAction()` (context switch tracking) + `MouseTravelCollector.notifyClick()` (end of productive travel segment).
-   Wheel event → `KeyboardCollector.notifyMouseAction()` (context switch tracking, throttled to 1 per 300ms).

All listeners use `capture: true, passive: true`. No collector calls `preventDefault`.

### 3.3 Background Service Worker (State)

The worker (`worker.ts`) is the single state authority. It owns the recording lifecycle and the benchmark report object.

**Key patterns:**

-   **Schema-compliant initialization**: `startRecording()` builds a complete benchmark report skeleton matching `benchmark.schema.json` before recording begins. It also **programmatically injects** the content script via `chrome.scripting.executeScript` to cover tabs that pre-date the extension install/update (the content script guards against double-initialization).
-   **Flush-before-finalize**: `stopRecording()` sends `FLUSH_AND_STOP_RECORDING` to the original recording tab, waits for collector flushes to enqueue their final metric updates, drains the worker event queue, then writes `benchmarkReport` to `chrome.storage.local` before notifying the side panel. This prevents trailing keyboard, scroll, and mouse-travel updates from being dropped.
-   **Original-tab stop**: The worker stores `recordingTabId` at start and stops that tab even if the researcher switches to another tab before stopping.
-   **Re-entrancy guard**: An `isTransitioning` flag prevents overlapping start/stop calls from the side panel or keyboard shortcut.
-   **Event queue serialization**: `handleEvent()` uses a promise chain (`eventQueue = eventQueue.then(...)`) to ensure only one event processes at a time. This prevents race conditions where rapid concurrent events (click + scroll) could read stale state and overwrite each other's updates.
-   **Event routing**: `handleEventInternal()` routes four payload types (`click`, `scroll_update`, `keyboard_update`, `mouse_travel_update`) to the appropriate metric fields. Click events also compute Fitts ID (Welford directional) and scanning distance inline.
-   **Live telemetry (event-driven)**: After each event, the worker broadcasts a `FEED_EVENT` message containing a metric snapshot (all 9 metrics). The side panel updates in real time from these events — no polling. A `stats` object is also written to `chrome.storage.local` for recovery when the side panel opens mid-recording.
-   **`chrome.action` guarding**: All `chrome.action` calls are wrapped in `if (chrome.action)` to prevent errors when the action API is unavailable.

### 3.4 Side Panel

The side panel (`app.ts` + `index.html`) is a terminal-style HUD designed for peripheral-vision monitoring during usability testing. Key behaviors:

-   **State machine**: Six explicit states (COLD_START → READY → STARTING → RECORDING → STOPPING → HAS_RUNS) controlling button labels, enable/disable states, and viewport select locking.
-   **Event-driven updates**: `FEED_EVENT` messages from the worker update all 9 live metrics in real time. `RECORDING_STARTED`/`RECORDING_STOPPED` trigger state transitions via `updateUI()`. No polling.
-   **Activity feed**: A scrolling timeline shows every captured event (clicks, scroll, keyboard, mouse travel, idle gaps). Auto-scrolls to bottom so the latest event is always visible. A prominent **null state** displays the current/next run number and explains multi-run averaging before recording begins.
-   **All 9 metrics live**: Time, Idle Gaps, Clicks, Target Effort (Fitts), Cursor (Travel), Eye Travel (Scan), Scroll, Switches, Shortcuts, Typing. Organized in logical groups (Temporal, Click & Targeting, Movement, Navigation, Input). Each metric label has a tooltip explaining what it measures.
-   **Native save dialog**: Downloads use `chrome.downloads.download({ saveAs: true })` to open the OS-native save dialog, letting the user choose the filename and location.
-   **Multi-run averaging**: `report.ts` averages recorded runs using a data-driven field list. Average fields and max fields are handled separately so exported `max_*` values remain tied to the run that produced the maximum. Output filename includes run count (e.g., `_AVG_3runs.json`).

### 3.5 Data Privacy

-   **Input values**: Never logged. The keyboard collector records event counts, modifier shortcut counts, input-field labels/placeholders, and field categories, not typed values.
-   **Storage**: `chrome.storage.local`. No server sync.

---

## 4. Test Infrastructure

The recorder uses **vitest** with `happy-dom` for DOM simulation. Chrome APIs are stubbed in `src/__mocks__/setup.ts`.

```bash
cd recorder && npm test          # vitest run
cd recorder && npm run test:watch # vitest (watch mode)
```

**Coverage**: 7 test files covering the worker, all 4 collectors (`clicks`, `scroll`, `keyboard`, `mouse-travel`), side panel utilities, and pure report export logic.

---

## 5. Technical Constraints

| Constraint                     | Mitigation                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| **Cross-origin iframes**       | Log "click-into-iframe"; noted as gap in report.                                         |
| **Service worker termination** | Side panel keeps worker alive while open.                                                |
| **Scroll performance**         | rAF batching per-frame, passive listeners.                                               |
| **Navigation gap**             | `navigation_gap_ms` exists in metadata; full navigation tracking is not implemented yet. |
