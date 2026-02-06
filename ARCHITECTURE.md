# UX Bench Architecture

## 1. Repository Structure

```
uxbench/
├── schema/
│   ├── benchmark.schema.json      # JSON Schema (the contract)
│   ├── benchmark.go               # Go types generated from schema
│   ├── benchmark.ts               # TypeScript types generated from schema
│   └── examples/                  # Example JSON files for testing
│
├── recorder/                      # Chrome Extension (TypeScript)
│   ├── manifest.json
│   ├── src/
│   │   ├── background/
│   │   │   ├── worker.ts          # Service worker (state machine, event routing)
│   │   │   └── worker.test.ts
│   │   ├── content/
│   │   │   ├── collector.ts       # Orchestrator — wires all 6 collectors
│   │   │   ├── clicks.ts          # Click capture, target geometry
│   │   │   ├── scroll.ts          # Page + container scroll distance (vertical + horizontal)
│   │   │   ├── keyboard.ts        # Context switches, shortcuts, typing ratio
│   │   │   ├── depth.ts           # Navigation depth via MutationObserver
│   │   │   ├── density.ts         # Information density via semantic-weighted DOM coverage
│   │   │   ├── wait.ts            # Application wait time (spinners, skeletons, loaders)
│   │   │   └── *.test.ts          # One test file per collector
│   │   ├── sidepanel/
│   │   │   ├── index.html         # Terminal-style HUD
│   │   │   └── app.ts             # UI state, event-driven feed, download averaging
│   │   └── __mocks__/setup.ts     # Chrome API stubs for vitest
│   ├── vitest.config.ts
│   └── package.json
│
├── cli/                           # Go CLI + TUI (Charm Bubble Tea)
│   ├── cmd/                       # Cobra commands
│   ├── analysis/                  # Comparison engine
│   ├── insights/                  # Diagnostic engine
│   ├── tui/                       # Bubble Tea UI
│   ├── format/                    # Output formatters
│   └── loader/                    # JSON loading
│
├── Makefile                       # Build system
└── .github/                       # CI/CD
```

### 1.1 Why a Monorepo

The schema is the contract. Changing a metric name or structure must update both the TypeScript types (Recorder) and Go types (CLI) in the same commit.

The two apps share no runtime code. They share the JSON Schema definition, from which both type systems are derived.

---

## 2. Shared JSON Schema

The schema (`schema/benchmark.schema.json`) is the single source of truth.

### 2.1 Design Principle: Context Is Required
The insight engine can only diagnose issues if the raw data carries context. Every metric object must include context fields (e.g., `_element`, `likely_cause`) identifying the specific UI element or moment responsible for the cost.

### 2.2 Schema Definition Overview

Detailed schema structure is defined in `schema/benchmark.schema.json`. Key sections:
-   **Metadata**: Product, Task, Operator (human/agent), Source.
-   **Metrics**: The 10 core efficiency metrics.
-   **Human Signals**: Derived signals like hesitation and decision time.

### 2.3 Type Generation

```bash
# TypeScript
npx json-schema-to-typescript schema/benchmark.schema.json > schema/benchmark.ts

# Go
go generate ./schema/...
```

---

## 3. Extension Architecture (Recorder)

### 3.1 Manifest V3

Key permissions: `activeTab`, `sidePanel`, `storage`, `commands`, `scripting`.
No remote code. Fully offline.

### 3.2 Content Script — Collector Architecture

The content script uses a **Collector orchestrator** (`collector.ts`) that wires six independent collectors. Each collector owns one concern and communicates to the worker via `chrome.runtime.sendMessage`.

```
Collector (orchestrator)
├── ClickCollector     → click events            → EVENT_CAPTURED {type: "click"}
├── ScrollCollector    → page + container scroll  → EVENT_CAPTURED {type: "scroll_update"}
├── KeyboardCollector  → keys, focus, shortcuts   → EVENT_CAPTURED {type: "keyboard_update"}
├── DepthCollector     → MutationObserver layers  → EVENT_CAPTURED {type: "depth_update"}
├── DensityCollector   → semantic DOM coverage    → EVENT_CAPTURED {type: "density_update"}
└── WaitCollector      → loading indicator timing → EVENT_CAPTURED {type: "wait_update"}
```

**Cross-collector coordination:** The orchestrator connects collectors via callbacks:
-   Click captured → `KeyboardCollector.notifyMouseAction()` (context switch tracking) + `DensityCollector.sampleOnInteraction()` (density sample at interaction time).
-   Scroll captured → `DensityCollector.sampleOnScroll()` (density sample during scroll, throttled to 1 per 2s).

All listeners use `capture: true, passive: true`. No collector calls `preventDefault`.

### 3.3 Background Service Worker (State)

The worker (`worker.ts`) is the single state authority. It owns the recording lifecycle and the benchmark report object.

**Key patterns:**
-   **Schema-compliant initialization**: `startRecording()` builds a complete benchmark report skeleton matching `benchmark.schema.json` before recording begins.
-   **Write-before-notify**: `stopRecording()` writes `benchmarkReport` to `chrome.storage.local` *before* sending `RECORDING_STOPPED`. The side panel reads the report after receiving the message, so it is guaranteed to exist.
-   **Re-entrancy guard**: An `isTransitioning` flag prevents overlapping start/stop calls from the side panel or keyboard shortcut.
-   **Event queue serialization**: `handleEvent()` uses a promise chain (`eventQueue = eventQueue.then(...)`) to ensure only one event processes at a time. This prevents race conditions where rapid concurrent events (click + scroll) could read stale state and overwrite each other's updates.
-   **Event routing**: `handleEventInternal()` routes six payload types (`click`, `scroll_update`, `keyboard_update`, `depth_update`, `density_update`, `wait_update`) to the appropriate metric fields. Click events also compute Fitts ID (Welford directional) and scanning distance inline.
-   **Live telemetry (event-driven)**: After each event, the worker broadcasts a `FEED_EVENT` message containing a metric snapshot (all 10 metrics + composite). The side panel updates in real time from these events — no polling. A `stats` object is also written to `chrome.storage.local` for recovery when the side panel opens mid-recording.
-   **`chrome.action` guarding**: All `chrome.action` calls are wrapped in `if (chrome.action)` to prevent errors when the action API is unavailable.

### 3.4 Side Panel

The side panel (`app.ts` + `index.html`) is a terminal-style HUD designed for peripheral-vision monitoring during usability testing. Key behaviors:
-   **State machine**: Six explicit states (COLD_START → READY → STARTING → RECORDING → STOPPING → HAS_RUNS) controlling button labels, enable/disable states, and viewport select locking.
-   **Event-driven updates**: `FEED_EVENT` messages from the worker update all 10 live metrics + composite in real time. `RECORDING_STARTED`/`RECORDING_STOPPED` trigger state transitions via `updateUI()`. No polling.
-   **Activity feed**: A scrolling timeline shows every captured event (clicks, scroll, keyboard, depth, density, wait, idle gaps). Auto-scrolls to bottom so the latest event is always visible.
-   **All 10 metrics live**: Clicks, Depth, Scroll, Fitts, Switches, Density, Shortcuts, Typing, Scan, Wait — plus Composite Cost. Each metric label has a tooltip explaining what it measures.
-   **Multi-run averaging**: Download handler averages all 10 metric groups across recorded runs using a data-driven field list. Output filename includes run count (e.g., `_AVG_3runs.json`).

### 3.5 Data Privacy

-   **Input values**: Never logged (except key identity for modifiers).
-   **Sensitive fields**: Password inputs logged as generic "sensitive interaction".
-   **Storage**: `chrome.storage.local`. No server sync.

---

## 4. Test Infrastructure

The recorder uses **vitest** with `happy-dom` for DOM simulation. Chrome APIs are stubbed in `src/__mocks__/setup.ts`.

```bash
cd recorder && npm test          # vitest run
cd recorder && npm run test:watch # vitest (watch mode)
```

**Coverage**: 7 test files covering the worker and all 6 collectors (`clicks`, `scroll`, `keyboard`, `depth`, `density`, `wait`).

---

## 5. Go Dependencies (CLI)

| Package | Purpose |
|---|---|
| `charmbracelet/bubbletea` | TUI framework (Elm Architecture) |
| `charmbracelet/lipgloss` | Terminal styling |
| `charmbracelet/bubbles` | UI components |
| `spf13/cobra` | CLI command structure |
| `nitcharts` | Bar charts |
| `gonum` | Statistics (Mann-Whitney U) |

---

## 6. Technical Constraints

| Constraint | Mitigation |
|---|---|
| **Cross-origin iframes** | Log "click-into-iframe"; noted as gap in report. |
| **Service worker termination** | Side panel keeps worker alive while open. |
| **Scroll performance** | rAF batching per-frame, passive listeners. |
| **Navigation gap** | 50-200ms blind spot during page load; logged as `navigation_gap_ms`. |
| **Color support** | Lip Gloss auto-detects terminal capabilities. |
