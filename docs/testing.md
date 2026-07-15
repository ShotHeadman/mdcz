# Testing Guide

MDCz uses risk-based test layers. Keep tests at the lowest layer that can prove the behavior, and use real lightweight boundaries when a mock would hide the risk being tested.

## Current baseline

Historical checkpoints (pre-layering ~129 files / 701 tests; early layered migration ~139 Vitest files / 714 tests) are superseded by the post-simplification measurement below (Child F remeasure after B–E, 2026-07-15, commit `5e32127`).

Measured Vitest discovery (`vitest list --json`; component uses `--staticParse`):

| Project | Files | Tests |
| --- | ---: | ---: |
| Unit | 96 | 464 |
| Browser component | 6 | 18 |
| Node integration | 14 | 81 |
| Desktop integration | 35 | 181 |
| Contract | 1 | 2 |
| Integration/live (explicit) | 1 | 1 |
| **Vitest total** | **153** | **747** |

Playwright product discovery (title scan of committed specs):

| Bucket | Specs | Tests |
| --- | ---: | ---: |
| Ordinary offline E2E | 2 | 7 |
| E2E/live workbench | 2 | 4 |

Executable scenario grand total: **758** (747 Vitest + 7 ordinary E2E + 4 E2E/live). Ordinary PR discovery never includes live specs.

Legacy filenames still mapped in `vitest.config.ts` run as Node or Desktop integration even when the path remains under `tests/unit`. Files that were substantially reorganized (Server composition, organizer, download keep, maintenance renderer) were renamed/moved and removed from the legacy maps.

The product layer keeps two offline Playwright smoke suites (7 journeys) and the fixed live set of 1 provider integration/live plus 4 workbench E2E/live journeys (Web/Desktop × scrape / `refresh_data`). Web smoke covers Server health, first-run setup plus login, configuration persistence across refresh, and isolated workbench media discovery. Desktop smoke covers a built Electron window, preload/main-process IPC, and configuration persistence across restart.

The V8 coverage baseline covers Server and the shared, runtime, persistence, and media-store business foundations through the non-browser Vitest projects. The checked-in floor is statements 78.8%, branches 64.1%, functions 80.4%, and lines 79.4%. It is a non-regression baseline, not a claim that every included file is sufficiently tested. Thresholds must not be lowered.

Workspace floors are derived from the same combined run, so coverage follows the production source file rather than the location or type of the test that executed it:

| Workspace | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| Server | 73.5% | 60.8% | 74.4% | 73.8% |
| Shared | 72.5% | 49.1% | 65.5% | 73.4% |
| Runtime | 80.3% | 65.8% | 84.3% | 81.0% |
| Persistence | 89.5% | 83.9% | 89.8% | 89.2% |
| Media store | 85.6% | 70.4% | 90.0% | 86.0% |

Both the aggregate and every workspace floor must pass. This prevents a coverage improvement in Persistence, for example, from hiding a regression in Shared.

## Test layers

| Layer | File convention | Purpose |
| --- | --- | --- |
| Unit | `*.unit.test.ts(x)` or legacy `*.test.ts(x)` | Pure logic, state transitions, parsers, and focused behavior with no real I/O |
| Integration | `*.integration.test.ts` | Real SQLite migrations, temporary filesystems, Fastify injection, streams, and other in-process boundaries |
| Desktop integration | `*.integration.test.ts` | Desktop services that use real I/O together with deterministic Electron/native-module boundary mocks |
| Contract | `*.contract.test.ts` | Shared schemas, DTO samples, serialization, and adapter agreement across packages or clients |
| Component | `*.component.test.tsx` | React interaction in real Chromium: semantics, focus, keyboard, async state, and dialogs |
| E2E | `*.e2e.spec.ts` | Real Web or Electron product journeys driven through browser/user-facing boundaries |

Legacy tests remain supported during migration. New tests must use the explicit suffix for their layer.

Legacy filenames are explicitly assigned to either `integration` or `desktop-integration` in `vitest.config.ts` during the migration. Classification by project is authoritative even when the file still lives under `tests/unit`. When one of these files is substantially reorganized, rename it to `*.integration.test.ts`, move it to an integration directory where practical, and remove its compatibility entry.

Do not convert an old test to E2E by name alone. An E2E test must start a real Web or Electron product topology and drive it through a user-facing boundary. Existing service/module tests with real I/O belong in integration; browser and Electron E2E are added as new Playwright journeys rather than relabeled unit tests.

## Test responsibility and overlap

Assign each business contract one primary owner layer. Tests may cover the same domain at several layers, but they should not repeat the same normal-path input and assertion merely because the implementation crosses several modules.

* Unit owns pure rules, state transitions, input combinations, and focused error/cancel/retry/rollback behavior that is difficult to observe or diagnose at a higher layer.
* Integration owns real lightweight composition such as SQLite, temporary filesystems, Fastify, streams, random loopback HTTP, and app-neutral runtime adapters.
* Component owns focused browser interaction and accessibility semantics.
* E2E owns built-product, browser/Electron, preload/IPC, transport, and target-specific user-journey wiring.

Before retiring a lower-layer test, identify a stable replacement that proves the same business contract, confirm the old test owns no unique branch or diagnostic boundary, run focused tests plus `pnpm test:coverage`, and record the replacement evidence. Zero removals is valid; reducing test count is not a quality target.

This testing guide is the durable source of truth for layer ownership; task-specific audits may keep a temporary responsibility matrix as evidence. Add a short file-local responsibility note only when a suite spans several domains or its boundary cannot be inferred from its name and focused counterparts; do not maintain a mandatory `Owns / Delegates / Counterparts` template.

## Commands

```bash
pnpm test:unit
pnpm test:integration # Node, Desktop, and contract projects
pnpm test:coverage # Core Server/package V8 baseline and HTML/JSON reports
pnpm exec vitest run --project component --silent
MDCZ_BROWSER_EXECUTABLE=/path/to/chromium pnpm exec vitest run --project component --silent
pnpm test
pnpm exec playwright install chromium # first local run or browser-version change
pnpm test:e2e
pnpm test:e2e -- --project=web-chromium # focused headless Web product run
MDCZ_BROWSER_EXECUTABLE=/path/to/chromium pnpm test:e2e -- --project=web-chromium
pnpm test:live             # full live gate: integration-live, Web E2E/live, Desktop E2E/live
node tests/e2e/web/run.mjs --live --project=web-chromium   # focused Web live diagnosis
node tests/e2e/web/run.mjs --live --project=desktop-electron # focused Desktop live diagnosis
node tests/e2e/web/run.mjs --live --project=web-chromium --headed # visible Web live
pnpm exec vitest run --project integration-live            # focused provider live
```

`pnpm test` remains the repository-wide Vitest aggregate command and now includes the Chromium component project. App-local tests continue to run through filtered workspace commands such as `pnpm --filter @mdcz/server test`. The focused component command intentionally stays a direct Vitest project selection so the root `package.json` does not accumulate another alias.

`pnpm test:coverage` runs unit, Node integration, Desktop integration, and contract projects with the V8 provider. It includes core source under `apps/server`, `packages/shared`, `packages/runtime`, `packages/persistence`, and `packages/media-store`, writes reports to the ignored `coverage/` directory, and fails when either the aggregate or a workspace baseline decreases. Browser component and Playwright product coverage remain separate because they require different instrumentation and should not distort the core Node baseline.

`pnpm test:e2e` builds the production WebUI, Server, and Desktop bundles. It allocates an available loopback port, creates isolated `.tmp/e2e-web` and `.tmp/e2e-desktop` runtime roots, starts the real Server, and runs both Chromium and Electron Playwright projects. It must be used instead of launching a spec directly because the harness supplies the target-specific Server persistence/media paths and the isolated Electron user-data directory. Focused Web/Desktop runs use disjoint runtime, media, server-log, report, and artifact paths, so sequential diagnosis cannot resume or overwrite sibling state. Playwright arguments are forwarded through the harness, so `pnpm test:e2e -- --project=web-chromium` runs only the headless Web project while preserving the same topology. Local Browser Mode and Web E2E runs can reuse a Chromium-compatible browser by setting `MDCZ_BROWSER_EXECUTABLE` to its actual executable path. Focused custom-browser E2E runs retain trace/screenshots but disable Playwright video so they do not require its managed ffmpeg. CI leaves the variable unset, uses Playwright's managed Chromium, and retains failure video. Linux CI runs the full command through `xvfb-run`.

## Directory responsibilities

```text
tests/
  unit/          unit tests plus legacy files temporarily mapped by project
  desktop-integration/ desktop runtime integration tests added after the migration
  integration/   cross-workspace or root-level integration tests
  live/          shared live catalog/report helpers, provider integration/live, live coordinator
  e2e/web/       Playwright Web product journeys and their lifecycle runner
  e2e/desktop/   Playwright Electron window, preload/IPC, and persistence smoke
  e2e/live/      shared workbench scrape/refresh journey helpers
  component/     Chromium-rendered React component interaction tests
  contracts/     shared contract samples and assertions
  fixtures/      small, deterministic, sanitized inputs
  factories/     typed domain and DTO builders with explicit overrides
  harness/       resource lifecycle helpers for databases, filesystems, and servers
```

Colocated tests under `apps/*` and `packages/*` are encouraged when they exercise one package. Root test directories are preferred for contracts and behavior crossing workspace boundaries.

## Mocking rules

* Mock only at a system boundary. Prefer public APIs and dependency injection over mocking internal implementation details.
* Electron and native-module aliases belong only to the unit and desktop-integration projects. Node integration and contract projects must not inherit unrelated runtime mocks.
* PR tests must not use uncontrolled public network services.
* Prefer a local fake HTTP server or deterministic fixture for external data.
* Restore fake timers, environment variables, spies, and module state after each test.
* Feature-specific crawler/live failures belong in a canonical local harness or the focused test file. Do not grow global setup with crawler/provider/network mocks used by only one feature.

## External and live tests

`live` describes an external-runtime dependency; it is not a new layer beside unit, integration, component, and E2E. Direct real-provider compatibility is `integration/live`. Built Web or Electron user journeys that call real providers are `E2E/live`.

MDCz ordinary PR commands remain offline from uncontrolled public services. The only package-level live entry point is `pnpm test:live`, which runs three isolated subprocesses in order: Vitest `integration-live`, Web Playwright live, and Desktop Playwright live. The coordinator continues after a failed child, keeps every layer's report, and exits non-zero if any step failed. The hard overall budget is 50 minutes including a reserved 5-second TERM/KILL grace: when a child is still running, cancellation starts inside the budget and remaining steps are skipped. SIGINT/SIGTERM also terminate all active process trees before exit. `test:live` rejects selection/interactive arguments; focused diagnosis uses the underlying runner or Vitest project directly.

Default live catalog is DMM-only (`dmm-ssis-497`). Integration/live discovers 1 provider case / 1 spec. Playwright live discovers 4 workbench journeys / 2 specs (Web/Desktop scrape and `refresh_data`). Ordinary E2E stays at 7 tests / 2 offline smoke specs and never discovers live files. Live cases use public identifiers and minimum stable field contracts. Reports record layer, target, phase, duration, and failure classification, and must not store credentials, request headers, private paths, or raw third-party bodies. Playwright Web and Desktop write to separate report/artifact directories (`playwright-report-web` / `playwright-report-desktop`, `test-results/playwright-web` / `test-results/playwright-desktop`) and separate `web-e2e-server.log` / `desktop-e2e-server.log` files so sequential coordinator steps never wipe sibling evidence. A `failureKind: parser` / `parse_error` is a provider contract failure, not an external network flake.

## Fixtures and factories

* Fixtures must be minimal, deterministic, sanitized, and committed only when their provenance and purpose are clear.
* Factories must provide valid defaults and accept partial overrides. Avoid one universal object containing fields irrelevant to most tests.
* Do not duplicate a large default object in multiple test files. Search `tests/factories` before adding another builder.
* Keep binary fixtures small; prefer generated samples when possible.

## Resource cleanup

* Use a unique temporary directory or in-memory database per test.
* Use random ports assigned by the operating system; never rely on a shared fixed test port.
* Harnesses own cleanup and make cleanup idempotent.
* Close databases, Fastify instances, HTTP servers, streams, and timers in `finally` or lifecycle hooks.
* Tests must not write to real user-data directories.
* Web E2E must use the harness-provided random port and isolated `MDCZ_HOME`; Desktop E2E must use the harness-provided Electron user-data directory. Do not point either suite at developer state.

## Maintainability rules

* New or substantially rewritten test files should stay below 500 lines. Split by route, service boundary, or behavior when they grow beyond that size.
* Assert user-visible behavior, public return values, persisted state, or shared contracts instead of private call order.
* Component tests use Vitest browser locators such as role, label, text, listbox, and dialog queries. CSS classes and React component instances are not primary selectors.
* Avoid large DOM or object snapshots. Use focused assertions that explain the protected behavior.
* A retry may identify an E2E test as flaky, but it must not hide the first failure.

## CI model

Pull requests run static quality, unit tests, Chromium component tests, Node/Desktop integration plus contract tests, core coverage, product E2E smoke, and product builds as separate jobs. The coverage job enforces the checked-in non-regression floor and always uploads its HTML and JSON reports. Component and E2E jobs install Chromium independently. Component failures upload Vitest browser screenshots; the E2E job uses Xvfb for Electron on Linux and always uploads the HTML report, JUnit output, Server/Desktop logs, traces, screenshots, and video files that were produced. CI retries a failing smoke once, while local runs do not retry.

## Remaining roadmap

The committed checkpoint covers layered Vitest execution, Browser component interaction, Web/Desktop product smoke, provider integration/live, workbench E2E/live, the unified `test:live` coordinator, diagnostics, CI separation, and the 2026-07-15 ownership simplification (no remaining unexempted 1,000-line suites; measured discovery above). Remaining quality-enhancement work:

* Continue trimming residual ≥500-line suites when their domains are touched (aggregation fixtures, Emby/Jellyfin shared rules, requeue setup, fixture-heavy actor sources) without deleting unique abort/rollback/parser risks.
* Expand Browser Mode coverage to additional settings focus and async error states as those components are touched.
* Observe and harden workbench live journeys across network conditions; keep ordinary PR gates offline and the live set at 1+4.
* Observe and harden Electron smoke across Windows/Linux before expanding its offline workflow coverage.
* Extend the V8 baseline toward changed-line/workspace-specific policy and add the flaky-test lifecycle.
