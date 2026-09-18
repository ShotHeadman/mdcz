# Observable contracts before Phase 0

This baseline precedes Step/Phase 0 of `/home/doublechu/Documents/mdcz_docs/claude/refactor_v2.md`. No production source or migration was changed. The plan intentionally changes partial publication and move-target replacement; those current behaviors are evidence to review, not invariants to freeze accidentally.

## Exact source under test

- Base revision: `56905f9cdeac943deb7a4e5c2f63c1018595f8e5`.
- Source patch SHA-256: `111e6f4b8d349b27f14e237f31295f52bc806901c4024c97445e872abe40bf43`, computed with `git diff HEAD -- apps tests packages | sha256sum` after staging the new files. Together these identify the actual tested source, including test instrumentation. All 17 trace artifacts have this same fingerprint.
- Production code is exactly the base revision. The commit containing this document adds only tests and evidence. The trace's `revision` refers to the base, not a claim that the instrumentation already existed in that commit.
- Captured on 2026-09-18, Linux, Node-native SQLite, pnpm 10.28.2, Vitest 4.1.5.

## Reproduction and measurement boundary

```sh
MDCZ_CAPTURE_BASELINE=/tmp/mdcz-baseline pnpm exec vitest run \
  --project integration --project desktop-integration \
  apps/server/src/app.observable-baseline.integration.test.ts \
  tests/desktop-integration/services/scraper/file_scraper_multipart.test.ts --silent
```

The parameterized representative movie is a single video or two numbered parts, with unique source contents. Both host paths exercise write/preserve and move output, and same-device and cross-device conditions: 16 cases. Cross-device is a deterministic `EXDEV` on the source-video rename, followed by the real copy/stage/promote path. It is not a physical second mounted filesystem. Write output must preserve sources regardless of that boundary; no source rename means no injected `EXDEV`.

The server fixture enters through authenticated `scrape.start`, uses real task persistence, downloads two PNG assets from a local HTTP server, generates NFO, and completes indexing. Metadata aggregation is deterministic; translation is disabled. The desktop fixture enters through the actual `@main` FileScraper adapter and commits through the real repositories and publisher. Its aggregation/download/NFO producers are stubbed using the existing desktop harness. This measures desktop adapter and publication behavior without Electron IPC or live crawler variability. An additional existing three-part/feature test is traced through its first publication; its subsequent version and maintenance checks still run outside the trace.

Each JSON contains ordered filesystem calls (including copies and attempted renames), executed SQL with bindings, transaction begin/commit/rollback, and channel counts. Filesystem inspection of assertions and fixture creation/cleanup is excluded. Roots and local HTTP ports are normalized; staging names, ids, SQL values and timestamps remain actual observations. Filesystem recording covers the listed promise APIs, not all kernel syscalls, sharp's native I/O, stream writes, or file-handle `sync` calls. `open` is recorded. SQL records statement execution, not preparation; transaction events describe the database transaction callback. Native SQLite's internal BEGIN/COMMIT are represented by these events, not invented SQL statements.

HTTP channels are the explicitly recorded start request and actual `NetworkClient.download` calls. Downloads are logical client calls, not a packet/retry trace. Status polling participates in the server SQL totals but is not counted as asset HTTP traffic. No credentials are recorded in HTTP events. Desktop producer stubs generate no HTTP traffic. Comparing raw server SQL totals requires accounting for polling; ownership reads should be selected from the SQL statements rather than equating every SELECT with ownership work.

## Actual counts

These are measured calls per movie group, not estimates. Source stats count only `<media>/<video>.mp4`; source-directory reads count only `<media>`. Other columns cover the entire recorded boundary. `SELECT` includes all `get`/`all` calls, including status polling.

| Host | Output | Device | Parts | Source readdir | Source stat | All realpath | Copies | statfs | SELECT | SQL writes | Transactions | Asset HTTP |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| desktop | write | same | 1 | 3 | 4 | 47 | 0 | 0 | 32 | 7 | 2 | 0 |
| desktop | write | cross | 1 | 3 | 4 | 47 | 0 | 0 | 32 | 7 | 2 | 0 |
| desktop | write | same | 2 | 6 | 8 | 50 | 0 | 0 | 38 | 9 | 2 | 0 |
| desktop | write | cross | 2 | 6 | 8 | 50 | 0 | 0 | 38 | 9 | 2 | 0 |
| desktop | move | same | 1 | 3 | 5 | 53 | 0 | 1 | 32 | 7 | 2 | 0 |
| desktop | move | cross | 1 | 3 | 5 | 55 | 1 | 1 | 35 | 7 | 2 | 0 |
| desktop | move | same | 2 | 6 | 10 | 62 | 0 | 2 | 38 | 9 | 2 | 0 |
| desktop | move | cross | 2 | 6 | 10 | 66 | 2 | 2 | 44 | 9 | 2 | 0 |
| server | write | same | 1 | 4 | 4 | 53 | 6 | 4 | 74 | 16 | 3 | 2 |
| server | write | cross | 1 | 4 | 4 | 53 | 6 | 4 | 74 | 16 | 3 | 2 |
| server | write | same | 2 | 7 | 8 | 60 | 6 | 4 | 91 | 19 | 3 | 2 |
| server | write | cross | 2 | 7 | 8 | 60 | 6 | 4 | 91 | 19 | 3 | 2 |
| server | move | same | 1 | 2 | 5 | 94 | 6 | 5 | 74 | 17 | 3 | 2 |
| server | move | cross | 1 | 2 | 5 | 96 | 7 | 5 | 79 | 17 | 3 | 2 |
| server | move | same | 2 | 4 | 10 | 106 | 6 | 6 | 91 | 21 | 3 | 2 |
| server | move | cross | 2 | 4 | 10 | 110 | 8 | 6 | 101 | 21 | 3 | 2 |
| desktop + feature | move | same | 3 | 9 | 21 | 100 | 0 | 4 | 44 | 12 | 2 | 0 |

## Differences from the plan's static counts

| Static claim | Observed evidence and interpretation |
| --- | --- |
| 5-8 source-directory reads per file | Selected-ref fixtures observe 2-4 per single file, and 4-7 per two-part server group. Total server readdir is 6-8 for one file, but includes output directories. Do not label total reads as source reads or extrapolate to discovery: these fixtures start from refs. Desktop observes 3 per member. |
| 5 source-video stats | Confirmed for move: 5 per member. Write observes 4 per member. The feature fixture additionally observes the feature file, yielding 21 total source-level video stats. |
| 1 extra copy per downloaded asset | Confirmed at publication: two staging copies for two downloaded assets. There are four additional image normalization copies, giving six copyFile calls even on the same device. Cross-device move adds exactly one required video copy per member. A future zero-extra-copy claim must distinguish publication copies from image processing. |
| 3-5 realpath per publication ref | Full boundaries observe 47-110 realpath calls. This is not a comparable per-ref denominator: it includes canonicalization of ancestors, missing targets and staging refs. Use the trace's paths to scope comparisons; do not multiply the static per-ref estimate by movie count. |
| 6 ownership queries plus obsolete files | Raw SELECT totals are 32-101, including task/history/journal work. This fixture has no obsolete assets. The static ownership denominator is not established by total SQL counts; recorded statements permit a later query-by-query ownership audit. |
| N translation requests for N parts | Not established: translation is disabled and metadata is supplied deterministically. Aggregation is observed once per group on both hosts. This baseline cannot justify a translation-request saving; an enabled translator workload is required before making that claim. |
| 1 statfs per publication operation | Counts depend on producer output: desktop write has zero operations/statfs; desktop move has one per video. Server write has four artifact operations/statfs; move adds one per member. Same-device publication also calls statfs. |
| Journal rows on every publication | Confirmed: server write and move both execute journal insertion and subsequent journal updates/deletion. Successful final cleanup leaves no durable open row; measuring only final table size would incorrectly report zero journal activity. |

The host matrices establish parity of observable video contents, source retention/removal, successful terminal results, one library movie with all members, one aggregation per group, and one required cross-device video copy. Their raw totals are intentionally not asserted equal because producer workloads and lifecycle boundaries differ. No conclusion about Electron IPC/network transport parity is implied.

## Coverage and deletion

See [coverage-matrix.md](coverage-matrix.md) for the contracts delegated to existing tests. The legacy server selected-parts test loses its repeated aggregation spy/count and final file-count assertion; the representative fixture checks those across both cardinalities. Its live-run payload, download grouping, movie identity and part-number/suffix assertions remain distinct coverage. No legacy setup is removed where it still supplies those contracts.

For later evaluation, replay this workload first, compare terminal/library/filesystem facts, then compare scoped I/O categories. Keep baseline JSON immutable and write future captures elsewhere. Treat partial-success and overwrite changes as explicit plan decisions. Establish additional enabled-translation and directory-discovery evidence before claiming savings for those workloads or changing their contracts.

## Verification

- Baseline capture: 27 tests passed in the two selected suites (16 parameterized representative cases plus the existing desktop cases); 17 trace artifacts emitted.
- `pnpm typecheck`: passed as the first stage of `pnpm check`.
- `pnpm exec biome check .`: passed after formatting the captured JSON; event values and source fingerprints are unchanged.
- `pnpm check`: 178 test files / 1,049 tests passed, then browser component startup failed because the Playwright Chromium headless shell was absent. Nine component files could not execute. Installing Chromium into `/tmp/mdcz-playwright` failed after repeated TLS `ECONNRESET` responses. This is an environment limitation; a fully green check is not claimed.
