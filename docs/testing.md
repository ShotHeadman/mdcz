# Testing Guide

MDCz uses risk-based test layers. Keep tests at the lowest layer that can prove the behavior, and use real lightweight boundaries when a mock would hide the risk being tested.

## Current baseline

The baseline recorded before this structure was introduced was 129 passing test files and 701 passing tests in about 13 seconds on a local Windows development machine. The repository had about 27,783 lines of tests, with most files classified under `tests/unit` regardless of their real boundary.

The current migration baseline is 138 passing Vitest files and 714 passing Vitest tests, plus six Playwright Web/Desktop smoke tests:

| Project | Files | Tests |
| --- | ---: | ---: |
| Unit | 88 | 436 |
| Browser component | 3 | 4 |
| Node integration | 11 | 79 |
| Desktop integration | 35 | 193 |
| Contract | 1 | 2 |

Thirty-eight legacy files that use real SQLite, temporary filesystems, Fastify/HTTP, or desktop runtime boundaries now execute as integration tests rather than unit tests.

The product layer now includes two Playwright suites with six smoke journeys. Web covers real Server health/startup, first-run setup plus fresh-browser login, and configuration persistence across a browser refresh. Desktop covers a built Electron window, preload/main-process IPC, and renderer-driven configuration persistence across an application restart.

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

## Commands

```bash
pnpm test:unit
pnpm test:integration # Node, Desktop, and contract projects
pnpm exec vitest run --project component --silent
pnpm test
pnpm exec playwright install chromium # first local run or browser-version change
pnpm test:e2e
```

`pnpm test` remains the repository-wide Vitest aggregate command and now includes the Chromium component project. App-local tests continue to run through filtered workspace commands such as `pnpm --filter @mdcz/server test`. The focused component command intentionally stays a direct Vitest project selection so the root `package.json` does not accumulate another alias.

`pnpm test:e2e` builds the production WebUI, Server, and Desktop bundles. It allocates an available loopback port, creates isolated `.tmp/e2e-web` and `.tmp/e2e-desktop` runtime roots, starts the real Server, and runs both Chromium and Electron Playwright projects. It must be used instead of launching a spec directly because the harness supplies the Web base/media paths and the isolated Electron user-data directory. Linux CI runs the command through `xvfb-run`.

## Directory responsibilities

```text
tests/
  unit/          unit tests plus legacy files temporarily mapped by project
  desktop-integration/ desktop runtime integration tests added after the migration
  integration/   cross-workspace or root-level integration tests
  e2e/web/       Playwright Web product journeys and their lifecycle runner
  e2e/desktop/   Playwright Electron window, preload/IPC, and persistence smoke
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

Pull requests run static quality, unit tests, Chromium component tests, Node/Desktop integration plus contract tests, product E2E smoke, and product builds as separate jobs. Component and E2E jobs install Chromium independently. Component failures upload Vitest browser screenshots; the E2E job uses Xvfb for Electron on Linux and always uploads the HTML report, JUnit output, Server/Desktop logs, traces, screenshots, and video files that were produced. CI retries a failing smoke once, while local runs do not retry.

## Remaining roadmap

The current committed checkpoint covers layered Vitest execution, Browser component interaction, Web/Desktop product smoke, diagnostics, and CI separation. The migration remains active for the following quality-enhancement work:

* Continue splitting the large Server, renderer, and scraper suites instead of only changing their project mapping.
* Expand Browser Mode coverage to settings validation, focus management, and additional async error states as those components are touched.
* Observe and harden the Web smoke suite before expanding it to scan/scrape/maintenance journeys.
* Observe and harden Electron smoke across Windows/Linux before expanding its workflow coverage.
* Add V8 coverage baselines, CI reports, and the flaky-test lifecycle.
