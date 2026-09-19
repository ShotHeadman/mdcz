import { describe, expect, it } from "vitest";
import { acquireOutputDirectories } from "./outputMutex";

describe("output directory serialization", () => {
  it("queues intersecting directory sets, leaves independent outputs free, and releases once", async () => {
    const order: number[] = [];
    const release = await acquireOutputDirectories(["/a/video.mp4", "/b/movie.nfo"]);
    const second = acquireOutputDirectories(["/b/other.mp4", "/a/poster.jpg"]).then((unlock) => {
      order.push(2);
      return unlock;
    });
    const third = acquireOutputDirectories(["/a/third.mp4"]).then((unlock) => {
      order.push(3);
      return unlock;
    });
    (await acquireOutputDirectories(["/c/video.mp4"]))();
    expect(order).toEqual([]);
    release();
    release();
    const unlockSecond = await second;
    expect(order).toEqual([2]);
    unlockSecond();
    (await third)();
    expect(order).toEqual([2, 3]);
    (await acquireOutputDirectories(["/b/again.mp4", "/a/again.mp4"]))();
  });
});
