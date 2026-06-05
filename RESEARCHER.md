# Researcher's Guide to UX Bench

**Version:** 2.0
**Date:** June 4, 2026

This guide explains what UX Bench measures and how to interpret the report without overclaiming what passive DOM observation can prove.

---

## 1. Measurement Philosophy

UX Bench measures observable interaction workload during a task. It records timing, click geometry, pointer movement, scrolling, input-mode changes, and shortcut use.

The recorder does **not** measure attention, comprehension, frustration, or intent. Treat the numbers as prompts for review, comparison, and follow-up observation rather than as standalone proof of usability quality.

---

## 2. Core Metrics

### 2.1 Time on Task

**What it measures:** Elapsed time between Start and Stop.

**How to use it:** Compare the same task across designs, runs, or participants. Absolute time is useful, but the strongest evidence comes from consistent reductions across repeated runs.

### 2.2 Idle Gaps

**What it measures:** Pauses longer than 3 seconds between user actions. Final collector flushes are excluded so a quiet stop does not create a false pause.

**How to use it:** Review the action before and after each pause. A pause may mean reading, waiting, thinking, searching, or an external interruption, so it needs context.

### 2.3 Click Count

**What it measures:** Total clicks, plus two explicit buckets:

-   **Ceremonial:** Clicks inside narrowly detected cookie, consent, GDPR, or privacy UI.
-   **Wasted:** Clicks on disabled elements (`disabled` or `aria-disabled="true"`).

**How to use it:** Total clicks show mechanical workload. Ceremonial and wasted clicks identify specific overhead or broken affordances. UX Bench no longer labels ordinary clicks as task-advancing because the DOM alone cannot prove user intent.

### 2.4 Target Effort (Fitts's Law)

**What it measures:** The effort to acquire click targets using the Shannon formulation of Fitts's Law with Welford directional target width.

```
W_eff = width x |cos(theta)| + height x |sin(theta)|
ID = log2(D / W_eff + 1)
```

`D` is the distance from the previous click point to the next target, and `W_eff` is the target width along the approach direction.

**How to use it:** High values point to small or distant targets that require precision. The report preserves the hardest targets so researchers can inspect concrete UI elements rather than just averages.

### 2.5 Cursor Travel

**What it measures:** Total pointer distance across the session, sampled from `mousemove` events with `requestAnimationFrame` batching.

**How to use it:** Cursor travel is raw motor movement. It can show that a task asks users to move across large parts of the interface, but it does not prove why the movement happened.

### 2.6 Scroll Distance

**What it measures:** Absolute scroll distance at page level and inside scrollable containers, including horizontal movement.

**How to use it:** High page scroll can indicate long flows or buried content. High container scroll can indicate cramped panels or overflow-heavy layouts. Use the heaviest-container field to find where the scroll cost concentrated.

### 2.7 Context Switches

**What it measures:** Transitions between mouse and keyboard input modes. The collector also preserves longest mouse and keyboard streaks.

**How to use it:** Frequent switching can indicate a workflow that makes users alternate between pointing and key entry. Long same-mode streaks usually mean the interface allowed a more continuous rhythm.

### 2.8 Shortcuts

**What it measures:** Modifier-key combinations using Ctrl, Cmd, or Alt with another key.

**How to use it:** Shortcut use can help distinguish novice and power-user runs. UX Bench does not verify whether a combination was meaningful to the target app; it only records that a modifier combo happened.

---

## 3. Interpreting Reports

-   Prefer comparisons over one-off thresholds.
-   Pair metrics with the action log and observation notes.
-   Inspect named elements for hard targets, ceremonial clicks, wasted clicks, long pauses, and heavy scroll containers.
-   Do not treat any single metric as a score. UX Bench is a structured measurement tool, not a usability oracle.
