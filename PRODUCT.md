# UX Bench — Product Specification

**Version:** 0.6
**Date:** February 23, 2026
**Status:** In Progress

---

## 1. What This Is

UX Bench is a Chrome extension that measures the interaction efficiency of web applications.

**The Recorder** captures every interaction event while a human user performs a task naturally on any web application, producing a JSON benchmark report with 9 core efficiency metrics.

---

## 2. Design Philosophy

Every design decision follows one principle: **the readout must be actionable to someone who has never heard of Fitts's Law.**

-   **Relatable**: Plain language, no jargon.
-   **Comparative**: Numbers only matter relative to something else.
-   **Diagnostic**: Names the specific element, interaction, or layout decision that's causing the cost.

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

The side panel is designed for **peripheral-vision monitoring** — the researcher watches the participant, not the panel. All 9 metrics are displayed live via event-driven updates from the worker, organized by category:

| Group             | Metric            | Purpose                                                  |
| ----------------- | ----------------- | -------------------------------------------------------- |
| Temporal          | **Time**          | Elapsed time since recording started                     |
|                   | **Idle Gaps**     | Pauses > 3s — user may be thinking or confused           |
| Click & Targeting | **Clicks**        | Total click count (productive, ceremonial, wasted)       |
|                   | **Target Effort** | Fitts' Law Index of Difficulty — effort to reach targets |
| Movement          | **Cursor**        | Total cursor travel distance — raw motor cost            |
|                   | **Eye Travel**    | Avg scanning distance between click targets              |
| Navigation        | **Scroll**        | Scroll distance in pixels                                |
|                   | **Switches**      | Mouse/keyboard context switches                          |
| Input             | **Shortcuts**     | Modifier-key combos used (Ctrl/Cmd/Alt + key)            |
|                   | **Typing**        | Free-text vs. constrained input ratio                    |

Hover any metric label for a tooltip explaining what it measures. An **Activity Feed** timeline shows every captured event in real time, with a prominent **null state** showing the current run number and explaining the multi-run averaging workflow.

### 3.2 Metrics Captured

The Recorder captures 9 core efficiency metrics.

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

---

## 4. Build Plan (See ARCHITECTURE.md for Technical Details)

### Completed

-   Schema and Recorder foundations.
-   All 9 metrics captured in Recorder (4 content-script collectors).
-   Multi-run averaging across all metric groups.
-   Vitest test suite (worker + 4 collectors + side panel utils + report export logic).
-   Welford directional Fitts's Law (approach-angle-aware target width).
-   Mouse travel tracking with idle/productive segmentation and path efficiency.
-   Event queue serialization (prevents race conditions in rapid event handling).
-   Event-driven side panel with activity feed timeline (all 9 metrics live, idle gap detection).
-   Cohesive design system (alpha scale, brand orange accent, semantic tokens).
-   Native save dialog for downloads (`chrome.downloads` API).
-   Programmatic content script injection (covers pre-existing tabs).
-   Flush-before-finalize stop lifecycle, so trailing keyboard, scroll, and cursor metrics are included in the saved report.
-   Original-tab stop tracking, so recording stops in the tab where it started even if focus changes.
-   Per-run collector resets, so repeated runs in the same tab do not inherit previous run metrics.

### Remaining

-   Human Signals (hesitation, decision time).
-   Release polish.

---

## 5. Success Criteria

1.  Recorder works with a single shortcut.
2.  Metrics are understandable by non-experts.
3.  Drill-downs name specific elements (not just numbers).
