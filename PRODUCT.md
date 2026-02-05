# UX Bench — Product Specification

**Version:** 0.3 — Refactored  
**Date:** February 4, 2026  
**Status:** In Progress

---

## 1. What This Is

UX Bench is two tools in one repository that together measure and compare the interaction efficiency of web applications.

**The Recorder** is a Chrome extension. A human user activates it, performs a task naturally on any web application, and stops it. The extension captures every interaction event and produces a JSON benchmark report with 10 quantitative efficiency metrics.

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
1.  Open Side Panel.
2.  Select **Viewport Size** (e.g., 1280x800).
3.  Click **START** (or press `Ctrl+Shift+R`).
4.  Perform task (observe Live Telemetry).
5.  Click **STOP**.
6.  (Optional) Repeat test for averaging.
7.  Click **DOWNLOAD**.

### 3.2 Metrics Captured
The Recorder captures 10 core efficiency metrics plus human signals. 

> **Detailed Metric Definitions**: See [RESEARCHER.md](./RESEARCHER.md) for the complete scientific breakdown of how these are measured and calculated.

**Core Metrics:**
1.  **Click Count**: Total, Productive, Ceremonial, Wasted.
2.  **Time on Task**: Active vs Idle, Application Wait.
3.  **Fitts's Law**: Index of Difficulty (Targeting effort).
4.  **Information Density**: Content vs Viewport area.
5.  **Context Switches**: Mouse/Keyboard transitions.
6.  **Shortcut Coverage**: Usage vs Opportunity.
7.  **Typing Ratio**: Free-text vs Constrained input.
8.  **Navigation Depth**: Max UI layer depth.
9.  **Scanning Distance**: Visual attention travel.
10. **Scroll Distance**: Physical navigation effort.

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

### Roadmap
-   **Phase 1**: Foundation (Schema, Recorder skeleton, CLI skeleton).
-   **Phase 2**: Cursor + Fitts + Summary TUI.
-   **Phase 3**: Timing + Depth + Insights.
-   **Phase 4**: Remaining Metrics + Radar.
-   **Phase 5**: Human Signals + CI + Polish.
-   **Phase 6**: Release.

---

## 7. Success Criteria

1.  Recorder works with a single shortcut.
2.  CLI comparison < 500ms.
3.  TUI is understandable by non-experts.
4.  Drill-downs name specific elements (not just numbers).
5.  CI Gate blocks regressions with clear explanations.
