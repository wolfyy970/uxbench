# UX Bench

**Interaction Efficiency Measurement Platform**

UX Bench is a Chrome Extension that measures the _work_ a user interface demands. It captures interaction events during usability testing and produces actionable efficiency metrics.

---

## Documentation Map

This README is the entry point. For details, consult the specific documents below:

-   **[PRODUCT.md](./PRODUCT.md)**: The single source of truth for features, product specification, and design philosophy. **Start here.**
-   **[RECORDER_GUIDE.md](./RECORDER_GUIDE.md)**: Installing the Chrome Extension, recording sessions, and multi-run averaging.
-   **[ARCHITECTURE.md](./ARCHITECTURE.md)**: System design, repository structure, schema definition, and technical constraints.
-   **[RESEARCHER.md](./RESEARCHER.md)**: Technical briefing on the scientific basis, measurement methodology, and calculation of the 9 core metrics.
-   **[DOCUMENTATION.md](./DOCUMENTATION.md)**: Guide for maintaining this documentation.

---

## Quick Start

### 1. Build

```bash
make all      # Builds the Chrome Extension into recorder/dist/
```

### 2. Record

Load the `recorder/dist` extension in Chrome. Navigate to your app, press `Ctrl+Shift+R`, perform a task, stop, and save the JSON.

---

## Repository Structure

```
uxbench/
├── schema/     # Data Contract (JSON Schema)
└── recorder/   # Chrome Extension (Capture)
```
