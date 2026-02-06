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
3.  **Flow:** Workflow continuity (interruptions, waiting, navigation depth).

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
*   **Ceremonial:** Interface overhead (e.g., closing popups, dismissing cookie banners). Detection uses narrowed selectors targeting cookie/consent/GDPR/privacy patterns to avoid false positives on legitimate UI elements.
*   **Wasted:** Clicks that produced no change (e.g., rage clicks, clicking disabled buttons). Double-click detection excludes editable elements (text inputs, contentEditable) where double-click is intentional (word selection).
**Interpretation:** A reduction in *Ceremonial* clicks (removing friction) is often more valuable than a reduction in *Productive* clicks (simplifying the task), as ceremonial clicks feel like "chores" to the user.

### 2.3 Typing vs. Constrained Input
**The Concept:** Typing is error-prone and slow compared to selection (Hick's Law notwithstanding).
**Interpretation:** A standard High-Efficiency target is **< 30% typing**. If your ratio is higher, look for opportunities to replace free-text fields with smart defaults, autocomplete, or segmented controls.

---

## 3. Cognitive Load Metrics
*Quantifying the mental cost of processing the interface.*

### 3.1 Information Density
**The Concept:** Visual clutter increases search time. We measure the ratio of "content pixels" (text, images, controls) to total viewport area.
**Methodology:** We use **semantic weighting** rather than raw pixel coverage. Not all visible elements contribute equally to information load:
*   **Weight 1.0:** Primary content — text (p, h1–h6, li, td, th, label, span with text).
*   **Weight 0.7–0.8:** Interactive elements — inputs, selects, buttons, tables.
*   **Weight 0.5:** Media — images, links.
*   **Weight 0.3:** Decorative — SVGs, generic containers.

Density is sampled at interaction time (each click) and during scroll events (throttled to one sample per 2 seconds), then averaged across all samples.

**Interpretation:**
*   **< 15% (Sparse):** Good for focus, but requires more scrolling/navigation to see data.
*   **15%–50% (Balanced):** Optimal for most enterprise applications.
*   **> 50% (Dense):** High cognitive load. Users will struggle to scan and find information ("haystack" effect).

### 3.2 Visual Scanning Distance
**The Concept:** How far does the user's eye travel between actions? If a user edits a field on the left, then has to check a value on the right, then click 'Save' at the bottom, their attention is ping-ponging across the screen.
**Methodology:** We calculate the Euclidean distance between consecutive interaction points.
**Interpretation:** High scanning distance correlates with fatigue and missed information. Grouping related controls (Theory of Proximity) directly reduces this metric.

### 3.3 Context Switches
**The Concept:** Switching between Mouse and Keyboard breaks flow. It requires a physical posture change and a mental mode shift.
**Methodology:** We track contiguous input "streaks" (consecutive mouse or keyboard actions). A context switch is recorded when the input modality changes. The longest keyboard and mouse streaks are preserved as indicators of flow continuity — long streaks mean the user stayed in one mode, which is good. Streaks are finalized at recording stop to avoid losing the final in-progress streak.
**Interpretation:** High switch counts indicate a disjointed UI.
*   *Bad:* Type Name -> Click Tab -> Type Address -> Click Tab. (high friction)
*   *Good:* Type Name -> Tab key -> Type Address. (low friction)

---

## 4. Flow & Continuity
*Quantifying the integrity of the user's journey.*

### 4.1 Navigation Depth
**The Concept:** How many "layers" deep is the user? (e.g., Page > Modal > Popover > Tooltip).
**Methodology:** A MutationObserver monitors the DOM for UI layer changes. Detected layer types include:
*   **Standards-based:** `dialog[open]`, `[role="dialog"]`, `[role="alertdialog"]`, `[role="menu"]`, `[role="listbox"]`, `[aria-modal="true"]`, `[popover]:popover-open`, `details[open]`.
*   **Framework patterns:** `.modal`, `.popover`, `.popup`, `.dropdown-menu`, `.overlay`, `.lightbox`, `[data-modal]`, `[data-popup]`.
*   **Transient UI:** `[class*="toast"]`, `[class*="snackbar"]`, `[role="status"]` toast variants.

Only visible layers (non-hidden, non-zero opacity, non-zero width) are counted. The depth path records up to the last 50 open/close transitions.

**Interpretation:**
*   **Depth 1-2:** ideal. The user feels grounded.
*   **Depth 3+:** "Lost in navigation." Users lose context of the background task. Closing the top layer often results in a momentary "where was I?" disorientation.

### 4.2 Application Wait Time
**The Concept:** Time the user spends waiting for the system (spinners, skeleton screens), distinct from time they spend thinking.
**Methodology:** A dedicated `WaitCollector` uses a MutationObserver plus a 500ms periodic check to detect visible loading indicators in the DOM. Detected patterns include:
*   `[class*="spinner"]`, `[class*="loading"]`, `[class*="skeleton"]`, `[class*="loader"]`
*   `[class*="progress"]`, `[role="progressbar"]`, `[aria-busy="true"]`
*   `.shimmer`, `[class*="placeholder"]`

Only elements that are visible (non-hidden, non-zero opacity, non-zero width) trigger wait timing. The collector measures cumulative milliseconds the user spent looking at loading states.

**Interpretation:** This is pure waste. It is the single highest-weighted penalty in our Interaction Cost model.

### 4.3 Decision Time vs. Idle Gaps
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
| **Wait Time** | 1.0x (sec) | Waiting breaks flow entirely. Heaviest penalty. |
| **Nav Depth** | 2.0x (layer) | Cognitive stack depth is mentally expensive to maintain. |
| **Switches** | 1.5x (event) | Physical mode switching breaks momentum. |
| **Fitts ID** | 1.0x (bits) | High precision requires muscular tension. |
| **Scrolling** | 0.005x (px) | Low cost, but cumulative over long sessions. |

*Note: This model assumes a standard "Productivity" persona. Weights can be adjusted in the settings if optimizing for other scenarios (e.g., "Casual Browsing").*
