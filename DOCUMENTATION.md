# Documentation Philosophy

## Core Principle

**Documentation serves as persistent memory between human and AI collaborators across context windows.** Well-structured docs enable seamless continuation without loss of critical knowledge.

**The cardinal rule: Just enough, no more.** Every line must earn its place. If information can be derived from code or official docs, don't duplicate it.

---

## Document Structure

**README.md is the ONLY entry point.** All other docs link from it. No intermediary navigation files.

```
README.md (Hub)
├── PRODUCT.md        — Feature spec, what exists
├── USER_GUIDE.md     — How to install, record, analyze
├── ARCHITECTURE.md   — System design, data flow, technical constraints
├── RESEARCHER.md     — Scientific basis, metric methodology
└── DOCUMENTATION.md  — This file (meta-documentation)
```

---

## Document Types

| Document | Purpose | Update Trigger |
|----------|---------|----------------|
| **README.md** | Entry point, quick start, doc map | Major features |
| **PRODUCT.md** | Feature source of truth (prevents hallucination) | Feature launches |
| **USER_GUIDE.md** | Installation, recording workflow, CLI usage | UX changes |
| **ARCHITECTURE.md** | System design, module boundaries, data flow | Architecture changes |
| **RESEARCHER.md** | Scientific methodology, metric definitions | Metric changes |
| **DOCUMENTATION.md** | Meta: documentation philosophy and rules | Rarely |

---

## Writing Rules

1. **One source of truth** — Each fact lives in exactly one place
2. **Link, don't duplicate** — Reference other docs instead of copying
3. **Practical over theoretical** — Working code > abstract explanations
4. **Assume knowledge gaps** — Explain "why" along with "how"
5. **Structure for scanning** — Clear headings, bullets, tables

---

## What NOT to Document

- ❌ Standard library/framework behavior (link to official docs)
- ❌ Obvious code patterns
- ❌ Extensive templates and examples (one suffices)
- ❌ Step-by-step tutorials for common operations
- ❌ Information derivable from reading the code

---

## Maintenance

**After code changes:**
1. Check which docs are affected
2. Update or remove outdated content
3. Verify cross-references still work

**Documentation bloat indicators:**
- Same information in multiple places
- Docs describing features that no longer exist
- Sections beginning with "Note: this is outdated..."
- Reader can't find information despite docs existing

**Be ruthless:** Delete obsolete content. Consolidate redundant docs. Prefer focused and impactful over comprehensive.

---

## Success Metrics

Documentation is working when:
- New collaborators understand the project in <10 minutes
- Getting it running takes <15 minutes
- Finding specific information takes <2 minutes
- AI assistants can resume work seamlessly across context windows
