import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mediaInfoFactory } from "mediainfo.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVideoProbe } from "./video";

vi.mock("mediainfo.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("mediainfo.js")>()),
  mediaInfoFactory: vi.fn(),
}));

let tempDir: string | undefined;

afterEach(async () => {
  vi.clearAllMocks();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("createVideoProbe", () => {
  it("shares one MediaInfo instance, forwards wasmPath, recovers from init failures, and analyzes one file at a time", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mdcz-video-probe-"));
    const videoPath = join(tempDir, "movie.mp4");
    const wasmPath = join(tempDir, "MediaInfoModule.wasm");
    await writeFile(videoPath, "video");
    let active = 0;
    let maxActive = 0;
    const analyzeData = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return {
        media: {
          track: [
            { "@type": "General", Duration: "120.5" },
            { "@type": "Video", Width: "3840", Height: "2160", BitRate: "8000000" },
          ],
        },
      };
    });
    vi.mocked(mediaInfoFactory)
      .mockRejectedValueOnce(new Error("transient init failure"))
      .mockResolvedValue({ analyzeData } as never);

    const probe = createVideoProbe(wasmPath);
    await expect(probe(videoPath)).rejects.toThrow("transient init failure");
    const results = await Promise.all([probe(videoPath), probe(videoPath), probe(join(tempDir, "movie.strm"))]);

    expect(results).toEqual([
      { durationSeconds: 120.5, width: 3840, height: 2160, bitrate: 8_000_000 },
      { durationSeconds: 120.5, width: 3840, height: 2160, bitrate: 8_000_000 },
      undefined,
    ]);
    expect(mediaInfoFactory).toHaveBeenCalledTimes(2);
    const locateFile = vi.mocked(mediaInfoFactory).mock.calls[1]?.[0]?.locateFile;
    expect(locateFile?.("MediaInfoModule.wasm", "")).toBe(pathToFileURL(wasmPath).href);
    expect(maxActive).toBe(1);
  });
});
