# Network record/replay

Record/replay lets the real scraper and workbench journey run without public network access. It replaces only `NetworkClient` transport; retry, timeout, rate limiting, parsing, aggregation, and output behavior stay unchanged.

## Fixtures

```text
tests/fixtures/network/
├── <caseId>/
│   ├── manifest.json
│   └── responses/
└── blobs/<sha256>
```

One manifest contains all recorded crawler and media interactions for the case. Channels such as `crawler:dmm` and `media` keep concurrent request streams independent. Large image and video bodies use content-addressed blobs; blobs are ignored by Git, and replay uses `tests/fixtures/mock-media/` when one is absent.

`caseId` is derived from the media filename (`SSIS-497.mp4` becomes `ssis-497`).

## Recording

```bash
pnpm record:webui
pnpm record:desktop
```

Crawler requests are captured in their website channel. `DownloadManager` runs its requests in the `media` fixture channel in the same case manifest.

Responses are written to `test-results/recording/network`, then the cases touched by the current run are copied into `tests/fixtures/network` when the application exits. Cookie, authorization, CSRF, query-token, and request-body credential values are replaced with deterministic test values before publication.

## Replay

```bash
pnpm test:e2e:fixtures
pnpm replay:desktop
```

Replay matches requests within the active item and channel. Each scrape execution gets a fresh playback cursor, so the same case can be stopped and started again without restarting the application. A missing interaction fails without public-network fallback.

`replay:desktop` resolves fixture paths from the workspace root and adds a 2-second delay before each recorded crawler or media response so pause, resume, and stop can be exercised manually. Override the delay with `MDCZ_REPLAY_DELAY_MS=5000 pnpm replay:desktop`.

The fixture E2E journey disables translation, media downloads, person images, and update checks. Media replay remains available for focused download or visual tests that explicitly enable those features.

Keep coverage at behavior boundaries: one record/replay round trip, credential redaction, and media fallback. Schema parsing and helper utilities do not need tests that merely restate their implementation.
