# Researcher's Guide to the UX Bench App

**Version:** 2.0 (Methods & Interpretation)  
**Date:** February 2026

This document is a briefing for **UX Researchers, Human-Computer Interaction (HCI) Specialists, and Data Scientists**.

It bridges the gap between the raw data collected by UX Bench and the qualitative user experience it represents. Use this guide to understand the scientific validity of the metrics, how to interpret the scores, and how to use this data to calculate ROI for design changes.

---

## 1. Measurement Philosophy

UX Bench performs **Quantitative Behavioral Analysis**.

Unlike usability testing (which captures *why* users struggle via think-aloud) or analytics (which captures *what* users do via conversion funnels), UX Bench captures **how much work** the interface demands.

We model "Work" in three dimensions:
1.  **Motor Load:** Physical effort (clicks, mouse travel, typing).
2.  **Cognitive Load:** Mental effort (decision time, visual scanning, memory load).
3.  **Flow:** Workflow continuity (interruptions, idle gaps).

**Methodology:** The data is collected via **passive DOM observation**. We do not rely on self-reporting. We measure the millisecond-precision timing and pixel-perfect geometry covering the user's session.

---

## 2. Motor Load Metrics
*Quantifying the physical cost of interaction.*

### 2.1 Fitts's Law (Index of Difficulty)
**The Concept:** Not all clicks are equal. Clicking a tiny button 800px away requires significantly more motor planning and precision (and is more error-prone) than clicking a large button nearby.
**Methodology:** We use the **Shannon Formulation** of Fitts's Law with **Welford's directional target width**. Rather than using `min(width, height)` as the effective target size (which ignores approach angle), we compute:

```
W_eff = width × |cos(θ)| + height × |sin(θ)|
```

where `θ` is the angle of approach from the previous cursor position to the target center. This means a wide horizontal button is easier to hit when approached horizontally, but not when approached vertically — matching real motor behavior. The final Index of Difficulty is:

```
ID = log₂(D / W_eff + 1)
```

**Interpretation:**
*   **Low ID (< 1.0):** Effortless. The user seemingly "thinks" a click and it happens.
*   **High ID (> 4.5):** High precision required. Users will inadvertently slow down to ensure accuracy.
*   **Insight:** If your "Save" button has a high Average ID, moving it closer to the input fields will mathematically increase throughput speed.

### 2.2 Click Count Breakdown
**The Concept:** Total click count is a blunt instrument. We separate clicks by *intent*.
**Categories:**
*   **Productive:** Advances the task (e.g., filling a form, clicking 'Next').
*   **Ceremonial:** Interface overhead that doesn't advance the task. Detection is intentionally narrow — only clicks inside elements matching cookie/consent/GDPR/privacy selector patterns (class, id, data-testid). No text-matching heuristics, which would false-positive on legitimate application dialogs.
*   **Wasted:** Clicks on disabled elements (`disabled` attribute or `aria-disabled="true"`). No timing-based heuristics — double-clicks and rapid clicks are legitimate interaction patterns.
**Interpretation:** A reduction in *Ceremonial* clicks (removing friction) is often more valuable than a reduction in *Productive* clicks (simplifying the task), as ceremonial clicks feel like "chores" to the user.

### 2.3 Mouse Travel (Cursor Distance)
**The Concept:** Fitts's Law and Scanning Distance only measure straight-line distances between click points. They don't capture the *actual path* the cursor took — all the overshooting, hunting, exploring, and correcting that happens between clicks.
**Methodology:** A `MouseTravelCollector` tracks cumulative cursor distance via a `mousemove` listener, batched through `requestAnimationFrame` for performance. Travel is segmented into **productive** (ended with a click) and **idle** (cursor movement that didn't result in a click — hunting, exploring, overshooting). The worker computes a **path efficiency** ratio: `scanning_distance / actual_travel`. A ratio near 1.0 means the user moved in efficient straight lines; lower values indicate wasted movement.
**Interpretation:**
*   **High idle travel:** The user is searching the interface — poor discoverability or misleading affordances.
*   **Low path efficiency (< 0.5):** Significant motor waste. The layout may be forcing circuitous navigation or elements look clickable but aren't.
*   **Insight:** Unlike Fitts (which measures targeting *difficulty*), Mouse Travel measures raw motor *cost*. An interface can have low Fitts IDs (easy targets) but high travel (targets are scattered).

*Note: Mouse Travel is not included in the Composite Score to avoid double-counting with Fitts ID and Scroll Distance. It stands as an independent motor load signal.*

### 2.4 Typing vs. Constrained Input
**The Concept:** Typing is error-prone and slow compared to selection (Hick's Law notwithstanding).
**Interpretation:** A standard High-Efficiency target is **< 30% typing**. If your ratio is higher, look for opportunities to replace free-text fields with smart defaults, autocomplete, or segmented controls.

---

## 3. Cognitive Load Metrics
*Quantifying the mental cost of processing the interface.*

### 3.1 Visual Scanning Distance
**The Concept:** How far does the user's eye travel between actions? If a user edits a field on the left, then has to check a value on the right, then click 'Save' at the bottom, their attention is ping-ponging across the screen.
**Methodology:** We calculate the Euclidean distance between consecutive interaction points.
**Interpretation:** High scanning distance correlates with fatigue and missed information. Grouping related controls (Theory of Proximity) directly reduces this metric.

### 3.2 Context Switches
**The Concept:** Switching between Mouse and Keyboard breaks flow. It requires a physical posture change and a mental mode shift.
**Methodology:** We track contiguous input "streaks" (consecutive mouse or keyboard actions). A context switch is recorded when the input modality changes. The longest keyboard and mouse streaks are preserved as indicators of flow continuity — long streaks mean the user stayed in one mode, which is good. Streaks are finalized at recording stop to avoid losing the final in-progress streak.
**Interpretation:** High switch counts indicate a disjointed UI.
*   *Bad:* Type Name -> Click Tab -> Type Address -> Click Tab. (high friction)
*   *Good:* Type Name -> Tab key -> Type Address. (low friction)

### 3.3 Scroll Distance
**The Concept:** Scroll distance quantifies the raw navigation effort required to find content. High scroll distances suggest content hierarchy or layout issues — the user is hunting for information.
**Methodology:** We track absolute scroll delta (both vertical and horizontal) at page level and inside scrollable containers, batched through `requestAnimationFrame`. Container scrolling is tracked separately from page scrolling. Each container's initial `scrollTop`/`scrollLeft` is recorded as a baseline on first encounter to avoid counting pre-existing scroll positions as user-initiated distance. The heaviest scrollable container is identified for diagnostic purposes.
**Interpretation:**
*   **High page scroll:** Long pages or poor content hierarchy.
*   **High container scroll:** Overflow-heavy UI (e.g., cramped data tables).
*   **Insight:** Scroll distance is included in the Composite Score (weight 0.005/px) — cumulative over long sessions it becomes a meaningful indicator of layout efficiency.

---

## 4. Flow & Continuity
*Quantifying the integrity of the user's journey.*

### 4.1 Decision Time vs. Idle Gaps
**The Concept:** We measure the idle time *between* actions.
*   **< 500ms:** Flow state. The user knows exactly what to do next.
*   **> 3s (Idle Gap):** The user has paused — they may be thinking, reading, or searching.
**Interpretation:** A cluster of idle gaps at a specific step may signal poor affordance or unclear copy. Cross-reference with the action log to understand context.

---

## 5. Composite Score Calculation

To allow for A/B comparison, we synthesize these metrics into a single "Interaction Cost" index.

**The Cost Model:**
We penalize metrics based on their estimated impact on user fatigue (derived from GOMS–Keystroke-Level Model principles).

| Factor | Weight | Rationale |
|---|---|---|
| **Switches** | 1.5x (event) | Physical mode switching breaks momentum. |
| **Fitts ID** | 1.0x (bits) | High precision requires muscular tension. |
| **Scrolling** | 0.005x (px) | Low cost, but cumulative over long sessions. |

*Note: This model assumes a standard "Productivity" persona. Weights can be adjusted in the settings if optimizing for other scenarios (e.g., "Casual Browsing").*
