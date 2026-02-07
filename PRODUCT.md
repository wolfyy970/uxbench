# UX Bench — Product Specification

**Version:** 0.5 — Quality & Correctness
**Date:** February 6, 2026
**Status:** In Progress

---

## 1. What This Is

UX Bench is two tools in one repository that together measure and compare the interaction efficiency of web applications.

**The Recorder** is a Chrome extension. A human user activates it, performs a task naturally on any web application, and stops it. The extension captures every interaction event and produces a JSON benchmark report with 9 core efficiency metrics.

**The Analyzer** is a Go CLI with an interactive terminal UI built on Charm's Bubble Tea. It ingests benchmark JSON files and presents head-to-head comparison in the terminal.

---

## 2. Readout Design Philosophy

Every design decision in the Analyzer follows from one principle: **the readout must be actionable to someone who has never heard of Fitts's Law.**

- **Relatable**: Plain language, no jargon.
- **Comparative**: Numbers only matter relative to something else.
- **Diagnostic**: Names the specific element, interaction, or layout decision that's causing the cost.

### 2.1 Hierarchy of Views

1.  **Comparison table:** The product. Who wins, by how much.
2.  **Composite bar chart:** The headline. Visceral gap visualization.
3.  **Radar profile:** The strategy view. Shape of strengths/weaknesses.
4.  **Drill-down insights:** The diagnosis. Specific elements causing the cost.

---

## 3. The Recorder (Chrome Extension)

### 3.1 User Flow
1.  Open Side Panel (auto-selects Tablet viewport — ready to record immediately).
2.  (Optional) Change **Viewport Size** via dropdown.
3.  Click **Start ⌘⇧R** (or press `Ctrl+Shift+R` / `Cmd+Shift+R`).
4.  Perform task — observe **Live Telemetry** updating in real-time.
5.  Click **Stop**.
6.  (Optional) Repeat for multi-run averaging.
7.  Click **Download** — native save dialog lets you name the file.

### 3.1.1 Live Telemetry (Side Panel)
The side panel is designed for **peripheral-vision monitoring** — the researcher watches the participant, not the panel. All 9 metrics plus composite are displayed live via event-driven updates from the worker, organized by category:

| Group | Metric | Purpose |
|-------|--------|---------|
| Temporal | **Time** | Elapsed time since recording started |
| | **Idle Gaps** | Pauses > 3s — user may be thinking or confused |
| Click & Targeting | **Clicks** | Total click count (productive, ceremonial, wasted) |
| | **Target Effort** | Fitts' Law Index of Difficulty — effort to reach targets |
| Movement | **Cursor** | Total cursor travel distance — raw motor cost |
| | **Eye Travel** | Avg scanning distance between click targets |
| Navigation | **Scroll** | Scroll distance in pixels |
| | **Switches** | Mouse/keyboard context switches |
| Input | **Shortcuts** | Modifier-key combos used (Ctrl/Cmd/Alt + key) |
| | **Typing** | Free-text vs. constrained input ratio |
| Summary | **Cost** | Composite interaction cost score |

Hover any metric label for a tooltip explaining what it measures. An **Activity Feed** timeline shows every captured event in real time, with a prominent **null state** showing the current run number and explaining the multi-run averaging workflow.

### 3.2 Metrics Captured
The Recorder captures 9 core efficiency metrics plus human signals. 

> **Detailed Metric Definitions**: See [RESEARCHER.md](./RESEARCHER.md) for the complete scientific breakdown of how these are measured and calculated.

**Core Metrics:**
1.  **Click Count**: Total, Productive, Ceremonial, Wasted.
2.  **Time on Task**: Active vs Idle.
3.  **Fitts's Law**: Index of Difficulty (Targeting effort).
4.  **Context Switches**: Mouse/Keyboard transitions.
5.  **Shortcut Usage**: Modifier-key combos (keyboard proficiency).
6.  **Typing Ratio**: Free-text vs Constrained input.
7.  **Scanning Distance**: Visual attention travel.
8.  **Scroll Distance**: Physical navigation effort.
9.  **Mouse Travel**: Total cursor distance (raw motor cost, path efficiency).

**Composite Score:**
A weighted interaction cost formula derived from the above.

---

## 4. The Analyzer (Go CLI)

### 4.1 CLI Commands

**`compare`**
Core command. Compares specific files or directories.
```bash
uxbench compare salesforce.json hubspot.json
uxbench compare --format markdown results/
```

**`inspect`**
Single recording deep-dive.
```bash
uxbench inspect recording.json
```

**`gate`**
CI regression check.
```bash
uxbench gate --baseline baseline.json input.json
```

**`baseline`**
Manage saved baselines.

### 4.2 Interactive TUI

Launched by default when running `compare` or `inspect` interactively.

**Summary View:** The primary comparison matrix.
**Radar View:** Press `r`. Normalized efficiency profile.
**Drill-Down:** Press `Enter` on any row. Shows diagnostic cards identifying specific UI elements (e.g., "Save button is 920px away").

**Key Bindings:**
-   `↑`/`↓`: Navigate
-   `Enter`: Drill down
-   `r`: Radar view
-   `s`: Save report
-   `q`: Quit

---

## 5. Non-Interactive Output

**Markdown**: Full report with summary table and key findings (insights). Perfect for PR comments.
**JSON/CSV**: structured data for external tools.
**Plain Text**: CI logs.

---

## 6. Build Plan (See ARCHITECTURE.md for Technical Details)

### Completed
-   Schema, Recorder, CLI foundations.
-   All 9 metrics captured in Recorder (4 content-script collectors).
-   Multi-run averaging across all metric groups.
-   Vitest test suite (worker + 4 collectors, 72 tests).
-   Summary TUI, Fitts drill-down, Radar view.
-   Welford directional Fitts's Law (approach-angle-aware target width).
-   Mouse travel tracking with idle/productive segmentation and path efficiency.
-   Event queue serialization (prevents race conditions in rapid event handling).
-   Event-driven side panel with activity feed timeline (all 9 metrics live, idle gap detection).
-   Cohesive design system (alpha scale, brand orange accent, semantic tokens).
-   Native save dialog for downloads (`chrome.downloads` API).
-   Programmatic content script injection (covers pre-existing tabs).

### Remaining
-   Human Signals (hesitation, decision time).
-   CI Gate command.
-   Release polish.

---

## 7. Success Criteria

1.  Recorder works with a single shortcut.
2.  CLI comparison < 500ms.
3.  TUI is understandable by non-experts.
4.  Drill-downs name specific elements (not just numbers).
5.  CI Gate blocks regressions with clear explanations.
