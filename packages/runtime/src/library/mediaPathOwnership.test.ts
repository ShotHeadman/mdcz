import { describe, expect, it } from "vitest";
import { MediaPathOwnership } from "./mediaPathOwnership";

describe("MediaPathOwnership", () => {
  it("acquires physical paths atomically and allows independent files", () => {
    const ownership = new MediaPathOwnership();
    const first = ownership.acquire("/media/b.mp4");
    expect(() => ownership.acquireAll(["/media/a.mp4", "/media/b.mp4"])).toThrow("already being modified");
    const independent = ownership.acquire("/media/a.mp4");
    independent();
    first();
    const release = ownership.acquireAll(["/media/b.mp4", "/media/a.mp4"]);
    expect(() => ownership.acquire("/media/a.mp4")).toThrow("already being modified");
    release();
    release();
    ownership.acquire("/media/a.mp4")();
    expect(() => ownership.acquire("")).toThrow("Media path key is required");
  });

  it("merges aliases and preserves the outer reservation after a nested release", () => {
    const ownership = new MediaPathOwnership();
    const outer = ownership.acquire("/media/video.mp4", "maintenance");
    const inner = ownership.acquireAll(["/media/video.mp4", "/media/video.mp4", "/media/video.nfo"], "maintenance");
    inner();
    expect(() => ownership.acquire("/media/video.mp4")).toThrow("already being modified");
    ownership.acquire("/media/video.nfo")();
    outer();
    ownership.acquire("/media/video.mp4")();
  });
});
