# UX Bench

**Interaction Efficiency Measurement Platform**

UX Bench is a toolkit for measuring the *work* a user interface demands. It captures interaction events via a Chrome Extension and analyzes them via a CLI/TUI to produce actionable, comparative efficiency metrics.

---

## Documentation Map

This README is the entry point. For details, consult the specific documents below:

*   **[PRODUCT.md](./PRODUCT.md)**: The single source of truth for features, product specification, and design philosophy. **Start here.**
*   **[USER_GUIDE.md](./USER_GUIDE.md)**: Step-by-step instructions for installing tools, recording sessions, and using the Analyzer TUI.
*   **[ARCHITECTURE.md](./ARCHITECTURE.md)**: System design, repository structure, schema definition, and technical constraints.
*   **[RESEARCHER.md](./RESEARCHER.md)**: Technical briefing on the scientific basis, measurement methodology, and calculation of the 10 core metrics.
*   **[DOCUMENTATION.md](./DOCUMENTATION.md)**: Guide for maintaining this documentation.

---

## Quick Start

### 1. Build
```bash
make all      # Builds Extension (recorder/) and CLI (cli/uxbench)
```

### 2. Record
Load the `recorder/dist` extension in Chrome. Navigate to your app, press `Ctrl+Shift+R`, perform a task, stop, and save the JSON.

### 3. Compare
```bash
# Interactive TUI
./cli/uxbench compare my-app.json competitor.json

# Export MD report
./cli/uxbench compare --format markdown my-app.json competitor.json > report.md
```

---

## Repository Structure

```
uxbench/
├── schema/     # Shared Data Contract (JSON Schema)
├── recorder/   # Chrome Extension (Capture)
└── cli/        # Go Analyzer (Comparison TUI)
```
