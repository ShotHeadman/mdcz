# Agent Guidelines & Engineering Directives

## 1. Project Context & Tooling
- **Project**: MDCz (Media metadata scraper - Monorepo with Electron desktop, server, and web UI).
- **Package Manager**: Use `pnpm` exclusively. NEVER use `npm` or `yarn`.
- **Verification Commands**:
  - Typecheck: `pnpm typecheck`
  - Tests: `pnpm test:unit` (or full suite: `pnpm test`)
  - Linter & Format: `pnpm format` (Biome)
  - Full Check: `pnpm check`

## 2. Core Mindset: Aggressive Modernization & Anti-Bloat
- **Zero Legacy Baggage**:
  - The project is under active development and testing. **Zero backward compatibility or migration concerns.**
  - **NEVER** keep backward compatibility shims, deprecated methods, or fallback branches for legacy behavior.
  - **DO NOT** hesitate to break outdated interfaces or structures if it leads to cleaner, more maintainable code.
- **Bias for Deletion & Simplicity**:
  - Reducing lines of code (LOC) and eliminating redundant layers is a primary success metric.
  - Strictly adhere to **YAGNI** (You Aren't Gonna Need It). **NEVER** write speculative abstractions, empty interfaces, or factory wrappers for "future proofing".
- **Modern Idioms Only**:
  - Use the latest TypeScript/Node native capabilities and standard library features over external dependencies or legacy workarounds.

## 3. Architecture & Strategic Workflow (Trigger-Action Rules)
- **Architecture-First**: Always step back and evaluate module structure before diving into local implementations. **DO NOT** apply local "band-aid" patches to flawed designs.
- **Refactoring Triggers**:
  - **WHEN** touching a file that has convoluted or messy logic -> **DO** aggressively rewrite, flatten, and simplify it in-place.
  - **WHEN** discovering cross-module architectural debt, duplication, or design smells outside the current task scope -> **DO NOT** refactor silently; **DO** proactively propose an RFC (Problem -> Proposed Design -> Benefit) and await approval before executing.

## 4. Code Style & Communication Standards
- **Flat & Self-Documenting**:
  - **DO NOT** extract single-use logic into multiple helper functions. Keep execution flow linear and easy to trace.
  - Avoid deeply nested conditionals. Prefer early returns and flat control flows.
- **Comments Policy**:
  - Code must be self-explanatory through precise naming.
  - **DO NOT** write comments explaining *what* the code does. **ONLY** add concise comments explaining *why* (the rationale) when dealing with non-obvious business constraints.
- **Fail Fast**:
  - In development and test phases, let errors throw loudly. **DO NOT** silently swallow exceptions with empty catch blocks or hidden defaults.
- **Decision Escalation**:
  - If a architectural or design choice involves notable trade-offs, concisely present the top 2 alternatives with pros/cons and let the user decide.
