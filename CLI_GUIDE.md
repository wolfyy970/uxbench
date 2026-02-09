# Analyzer CLI User Guide

The Analyzer compares your recording files to reveal which interface demands less work.

---

## Installation

### 1. Build
From the repository root:
```bash
make all
```
This produces the binary at `cli/uxbench`.

### 2. Install Globally
To use `uxbench` anywhere in your terminal:
```bash
make install
```
*Note: Ensure your Go bin directory (typically `$HOME/go/bin`) is in your system `$PATH`.*

---

## Basic Comparison

Run the CLI pointing to two or more JSON files:
```bash
uxbench compare old-design.json new-design.json
```
This launches the **Interactive TUI**.

---

## Navigating the TUI

| Key | Action |
|---|---|
| `↑` `↓` | **Navigate** through metrics rows |
| `Enter` | **Drill Down** to see *why* a metric is high (Diagnostic View) |
| `Esc` | **Back** to the previous view |
| `r` | **Radar View** — See the "shape" of efficiency tradeoffs |
| `s` | **Save Report** — Exports a markdown summary to `comparison_report.md` |
| `q` | **Quit** |

---

## Drill-Down Diagnostics

When your score is lower than the competitor's, press `Enter` on the losing metric to find out why.
-   **Fitts:** Tells you exactly which buttons were hardest to reach.
-   **Clicks:** Lists specific "Ceremonial" clicks (popups, toasts) you can remove.
-   **Scanning:** Identifies large visual jumps between related controls.

---

## Non-Interactive Reports

For sharing on GitHub or Slack without using the TUI:
```bash
# Generate a Markdown table with insights
uxbench compare --format markdown design_a.json design_b.json > results.md

# Export as CSV for spreadsheet analysis
uxbench compare --format csv design_a.json design_b.json > results.csv
```

---

## Troubleshooting

**"CLI: command not found"**
Ensure `$HOME/go/bin` is in your shell `PATH`, or run the binary locally using `./cli/uxbench`.

**"Different Metrics Logic?"**
If comparing a Human recording vs a Playwright automation, some metrics (Decision Time, Mouse Hesitation) will be null for the bot. The Analyzer handles this gracefully but warns you.
