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
│   │   │   ├── collector.ts       # Orchestrator — wires all 5 collectors
│   │   │   ├── clicks.ts          # Click capture, target geometry
│   │   │   ├── scroll.ts          # Page + container scroll distance
│   │   │   ├── keyboard.ts        # Context switches, shortcuts, typing ratio
│   │   │   ├── depth.ts           # Navigation depth via MutationObserver
│   │   │   ├── density.ts         # Information density via DOM coverage
│   │   │   └── *.test.ts          # One test file per collector
│   │   ├── sidepanel/
│   │   │   ├── index.html         # Terminal-style HUD
│   │   │   └── app.ts             # UI state, telemetry polling, download averaging
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

The content script uses a **Collector orchestrator** (`collector.ts`) that wires five independent collectors. Each collector owns one concern and communicates to the worker via `chrome.runtime.sendMessage`.

```
Collector (orchestrator)
├── ClickCollector     → click events          → EVENT_CAPTURED {type: "click"}
├── ScrollCollector    → page + container scroll → EVENT_CAPTURED {type: "scroll_update"}
├── KeyboardCollector  → keys, focus, shortcuts  → EVENT_CAPTURED {type: "keyboard_update"}
├── DepthCollector     → MutationObserver layers → EVENT_CAPTURED {type: "depth_update"}
└── DensityCollector   → DOM coverage sampling   → EVENT_CAPTURED {type: "density_update"}
```

**Cross-collector coordination:** The orchestrator connects collectors via callbacks. When a click is captured, `KeyboardCollector.notifyMouseAction()` fires (for context switch tracking) and `DensityCollector.sampleOnInteraction()` fires (to sample density at interaction time).

All listeners use `capture: true, passive: true`. No collector calls `preventDefault`.

### 3.3 Background Service Worker (State)

The worker (`worker.ts`) is the single state authority. It owns the recording lifecycle and the benchmark report object.

**Key patterns:**
-   **Schema-compliant initialization**: `startRecording()` builds a complete benchmark report skeleton matching `benchmark.schema.json` before recording begins.
-   **Write-before-notify**: `stopRecording()` writes `benchmarkReport` to `chrome.storage.local` *before* sending `RECORDING_STOPPED`. The side panel reads the report after receiving the message, so it is guaranteed to exist.
-   **Re-entrancy guard**: An `isTransitioning` flag prevents overlapping start/stop calls from the side panel or keyboard shortcut.
-   **Event routing**: `handleEvent()` routes five payload types (`click`, `scroll_update`, `keyboard_update`, `depth_update`, `density_update`) to the appropriate metric fields. Click events also compute Fitts ID and scanning distance inline.
-   **Live telemetry**: After each event, the worker writes a `stats` object to storage (clicks, depth, scroll, switches) that the side panel polls at 1Hz.
-   **`chrome.action` guarding**: All `chrome.action` calls are wrapped in `if (chrome.action)` to prevent errors when the action API is unavailable.

### 3.4 Side Panel

The side panel (`app.ts` + `index.html`) is a terminal-style HUD. Key behaviors:
-   **Single update path**: `updateUI()` is called only from the worker's broadcast messages (`RECORDING_STARTED`, `RECORDING_STOPPED`). No double-fires.
-   **Live telemetry**: Polls `chrome.storage.local` every 1s for `stats` (clicks, depth, scroll, switches) and `recordingState.startTime` (live timer).
-   **Multi-run averaging**: Download handler averages all 10 metric groups across recorded runs. Output filename includes run count (e.g., `_AVG_3runs.json`).

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

**Coverage**: 6 test files covering the worker and all 5 collectors (`clicks`, `scroll`, `keyboard`, `depth`, `density`).

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
