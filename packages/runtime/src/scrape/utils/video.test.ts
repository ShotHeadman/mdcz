import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mediaInfoFactory } from "mediainfo.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVideoProbe } from "./video";

vi.mock("mediainfo.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("mediainfo.js")>()),
  mediaInfoFactory: vi.fn(),
}));

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("createVideoProbe", () => {
  it("shares one MediaInfo instance and analyzes one file at a time", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mdcz-video-probe-"));
    const videoPath = join(tempDir, "movie.mp4");
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
    vi.mocked(mediaInfoFactory).mockResolvedValue({ analyzeData } as never);

    const probe = createVideoProbe();
    const results = await Promise.all([probe(videoPath), probe(videoPath), probe(join(tempDir, "movie.strm"))]);

    expect(results).toEqual([
      { durationSeconds: 120.5, width: 3840, height: 2160, bitrate: 8_000_000 },
      { durationSeconds: 120.5, width: 3840, height: 2160, bitrate: 8_000_000 },
      undefined,
    ]);
    expect(mediaInfoFactory).toHaveBeenCalledTimes(1);
    expect(maxActive).toBe(1);
  });
});
