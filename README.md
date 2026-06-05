# UX Bench

**Interaction Efficiency Measurement Platform**

UX Bench measures the observable interaction workload a user interface demands. It can run as a Chrome harness for browser recording or as an embedded browser library inside a web application.

---

## Documentation Map

This README is the entry point. For details, consult the specific documents below:

-   **[PRODUCT.md](./PRODUCT.md)**: The single source of truth for features, product specification, and design philosophy. **Start here.**
-   **[RECORDER_GUIDE.md](./RECORDER_GUIDE.md)**: Installing the Chrome harness, recording sessions, and multi-run averaging.
-   **[LIBRARY_GUIDE.md](./LIBRARY_GUIDE.md)**: Embedding UX Bench in a web application and handling task payload callbacks.
-   **[ARCHITECTURE.md](./ARCHITECTURE.md)**: System design, repository structure, schema definition, and technical constraints.
-   **[RESEARCHER.md](./RESEARCHER.md)**: Technical briefing on the measurement methodology and interpretation of the core metrics.
-   **[DOCUMENTATION.md](./DOCUMENTATION.md)**: Guide for maintaining this documentation.

---

## Quick Start

### 1. Build

```bash
make all      # Builds the recorder package into recorder/dist/
```

### 2. Record

Load the `recorder/dist` extension in Chrome. Navigate to your app, press `Ctrl+Shift+R`, perform a task, stop, and save the task payload JSON.

### 3. Embed

Import the library bundle from `recorder/dist/uxbench.esm.js` or use `recorder/dist/uxbench.iife.js` from a script tag. Host applications call `startTask()` and receive completed task payloads through a callback.

---

## Repository Structure

```
uxbench/
├── schema/     # Task payload JSON Schema
└── recorder/   # Shared core, browser instrumentation, library, and Chrome harness
```
