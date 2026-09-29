# Network record/replay

Record/replay lets the real scraper run without public network access. It replaces only `NetworkClient` transport; retry, timeout, parsing, aggregation, download, and output behavior stay unchanged.

## Fixtures

```text
tests/fixtures/network/
├── <caseId>/
│   ├── manifest.json
│   └── responses/
└── blobs/<sha256>
```

One manifest contains all recorded crawler and media interactions for one movie. Channels such as `crawler:dmm` and `media` keep concurrent request streams independent.

`caseId` is the movie number (`SNOS-301` becomes `snos-301`), so split discs, STRM files, and other versions of one movie share one recording.

Image and video bodies are content-addressed blobs that stay out of Git. The manifest records each image's size and dimensions, so replay can stand in a generated image with the same dimensions and byte length when a blob is absent. Integration tests always use generated images, which keeps their output identical on every machine.

## Recording

```bash
pnpm record:desktop
pnpm record:webui
```

Scrape the movies to record in one session, with the same sites enabled that the integration tests use. Every manifest must come from a single run; a manifest stitched from separate runs contains requests no real run makes. Start from an empty output folder: assets already there are kept instead of downloaded, so their requests would be missing from the recording.

Responses are written to `test-results/recording/network`, then the cases touched by the current run are published to `tests/fixtures/network` when the application exits. Image and video responses already published for a case are reused instead of downloaded again; crawler pages are always fetched live. Cookie, authorization, CSRF, query-token, and request-body credential values are replaced with deterministic test values before publication.

## Replay

```bash
pnpm replay:desktop
pnpm replay:webui
```

Replay matches requests within the active movie and channel, and each scrape execution starts from a fresh playback cursor. A missing interaction fails without public-network fallback. Manual replay adds a 500ms delay before each response so pause, resume, and stop can be exercised; override it with `MDCZ_REPLAY_DELAY_MS=5000 pnpm replay:webui`.

## Scenario tests

`apps/server/src/app.scrape-replay.integration.test.ts` drives the Server's directory scrape against the recordings and snapshots the output tree, NFO fields, and library entries of each scenario. Add a row there for a new file layout; only a new movie number needs a new recording.

The pipeline tolerates network failures by design, so a request the recordings lack would otherwise fall back silently. The scenario tests therefore fail on any missing interaction; record the affected movie again when that happens.
