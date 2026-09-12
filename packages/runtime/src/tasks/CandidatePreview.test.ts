import { describe, expect, it, vi } from "vitest";
import { CandidatePreview } from "./CandidatePreview";

describe("candidate preview cancellation", () => {
  it.each([
    "before registration",
    "during I/O",
  ])("settles without starting more work when cancelled %s", async (timing) => {
    const previews = new CandidatePreview();
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let enter!: (signal: AbortSignal) => void;
    const entered = new Promise<AbortSignal>((resolve) => {
      enter = resolve;
    });
    const scan = vi.fn(async (signal: AbortSignal) => {
      enter(signal);
      await released;
      signal.throwIfAborted();
      return ["video.mp4"];
    });
    if (timing === "before registration") await previews.cancel("preview");
    const completion = previews.run("preview", scan);
    const rejected = expect(completion).rejects.toMatchObject({ name: "AbortError" });
    if (timing === "during I/O") {
      const signal = await entered;
      let settled = false;
      const cancellation = previews.cancel("preview").then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(signal.aborted).toBe(true);
      expect(settled).toBe(false);
      release();
      await cancellation;
    } else {
      expect(scan).not.toHaveBeenCalled();
    }
    await rejected;
    await expect(previews.run("fresh-preview", async () => ["video.mp4"])).resolves.toEqual(["video.mp4"]);
  });
});
