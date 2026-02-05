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
│   │   ├── background/            # Service worker (Session state)
│   │   ├── content/               # Content script (Event capture)
│   │   └── sidepanel/             # Side panel UI
│   └── build.sh
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

Key permissions: `activeTab`, `sidePanel`, `storage`, `commands`.
No remote code. Fully offline.

### 3.2 Content Script (Event Capture)

Listens on `document` (capture phase, passive).
-   **Sampling**: `mousemove` and scroll sampled at 60Hz via `requestAnimationFrame` into a ring buffer.
-   **MutationObserver**: Tracks DOM changes for Density and Navigation Depth.
-   **Passive Observation**: Never blocks the main thread or calls `preventDefault`.

### 3.3 Background Service Worker (State)

Maintains session state across page navigations.
-   Receives `beforeunload` summary from content script.
-   Re-injects and bridges state to new content script on `ready`.
-   **Keep-alive**: Heartbeat every 25s to prevent termination.

### 3.4 Data Privacy

-   **Input values**: Never logged (except key identity for modifiers).
-   **Sensitive fields**: Password inputs logged as generic "sensitive interaction".
-   **Storage**: `chrome.storage.local`. No server sync.

---

## 4. Go Dependencies (CLI)

| Package | Purpose |
|---|---|
| `charmbracelet/bubbletea` | TUI framework (Elm Architecture) |
| `charmbracelet/lipgloss` | Terminal styling |
| `charmbracelet/bubbles` | UI components |
| `spf13/cobra` | CLI command structure |
| `nitcharts` | Bar charts |
| `gonum` | Statistics (Mann-Whitney U) |

---

## 5. Technical Constraints

| Constraint | Mitigation |
|---|---|
| **Cross-origin iframes** | Log "click-into-iframe"; noted as gap in report. |
| **Service worker termination** | Keep-alive heartbeat every 25s. |
| **`mousemove` performance** | rAF sampling (60Hz), passive listeners. Target <1ms. |
| **Navigation gap** | 50-200ms blind spot during page load; logged as `navigation_gap_ms`. |
| **Color support** | Lip Gloss auto-detects terminal capabilities. |
