import { describe, expect, it, vi } from "vitest";

const { mediaInfoFactoryMock, analyzeDataMock, getMaxConcurrent, resetConcurrencyState } = vi.hoisted(() => {
  let active = 0;
  let maxConcurrent = 0;

  const analyzeDataMock = vi.fn(async () => {
    active += 1;
    maxConcurrent = Math.max(maxConcurrent, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return { media: { track: [] } };
  });

  return {
    mediaInfoFactoryMock: vi.fn(async () => ({
      analyzeData: analyzeDataMock,
    })),
    analyzeDataMock,
    getMaxConcurrent: () => maxConcurrent,
    resetConcurrencyState: () => {
      active = 0;
      maxConcurrent = 0;
      analyzeDataMock.mockClear();
      mediaInfoFactoryMock.mockClear();
    },
  };
});

describe("runWithMediaInfo", () => {
  it("serializes analyzeData access on the shared MediaInfo instance", async () => {
    resetConcurrencyState();
    (
      globalThis as typeof globalThis & {
        __mdczMediaInfoMock?: { factory: typeof mediaInfoFactoryMock };
      }
    ).__mdczMediaInfoMock = {
      factory: mediaInfoFactoryMock,
    };
    vi.resetModules();
    const { runWithMediaInfo } = await import("@main/utils/video");

    await Promise.all([
      runWithMediaInfo(
        async (mediaInfo) =>
          await mediaInfo.analyzeData(
            () => 0,
            async () => new Uint8Array(0),
          ),
      ),
      runWithMediaInfo(
        async (mediaInfo) =>
          await mediaInfo.analyzeData(
            () => 0,
            async () => new Uint8Array(0),
          ),
      ),
      runWithMediaInfo(
        async (mediaInfo) =>
          await mediaInfo.analyzeData(
            () => 0,
            async () => new Uint8Array(0),
          ),
      ),
    ]);

    expect(mediaInfoFactoryMock).toHaveBeenCalledTimes(1);
    expect(analyzeDataMock).toHaveBeenCalledTimes(3);
    expect(getMaxConcurrent()).toBe(1);
  });
});
