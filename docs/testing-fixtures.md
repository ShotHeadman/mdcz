# Crawler record/replay

Record/replay lets the real crawler parsers and workbench journey run without public network access. It is enabled only through environment variables; normal application startup still uses `NetworkClient`.

## Fixtures

Crawler responses are text-only:

```text
tests/fixtures/crawler/<website>/<caseId>/
├── cassette.json
└── responses/
```

Downloads use a small manifest plus content-addressed blobs:

```text
tests/fixtures/media/<caseId>/manifest.json
tests/fixtures/media/blobs/<sha256>
```

Blobs are ignored by Git. If a blob is absent, replay uses the small image or video in `tests/fixtures/mock-media/`. To use private real-media fixtures:

```bash
pnpm fixtures:media:hydrate /path/to/private-media
```

`caseId` is derived from the media filename (`SSIS-497.mp4` becomes `ssis-497`). A scrape item may record separate cassettes for several websites under the same case.

## Recording

```bash
pnpm record:webui
pnpm record:desktop
```

Crawler requests are captured inside `CrawlerSourceContext`. Image and video responses are excluded. `MediaFixtureContext` surrounds `DownloadManager`, so requested downloads are recorded in the media manifest instead.

Responses are written to `test-results/recording`, then the cases touched by the current run are copied into `tests/fixtures` when the application exits. Cookie, authorization, CSRF, query-token, and request-body credential values are replaced with deterministic test values before publication.

## Replay

```bash
pnpm test:e2e:fixtures
```

Replay matches requests within the active item and website contexts. A missing interaction fails immediately; public-network fallback is disabled. Shutdown also fails if a loaded cassette still has unconsumed interactions.

The fixture E2E journey disables translation, media downloads, person images, and update checks. Media replay remains available for focused download or visual tests that explicitly enable those features.

Keep coverage at behavior boundaries: one record/replay round trip, credential redaction, and media fallback. Schema parsing and helper utilities do not need tests that merely restate their implementation.
