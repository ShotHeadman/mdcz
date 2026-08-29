import { describe, expect, it } from "vitest";
import { MediaPathOwnership } from "./mediaPathOwnership";

describe("MediaPathOwnership", () => {
  it("rejects concurrent ownership of the same normalized root-relative path", () => {
    const ownership = new MediaPathOwnership();
    const release = ownership.acquire("root-1", "movies\\ABC-001.mp4");

    expect(() => ownership.acquire("root-1", "movies/ABC-001.mp4")).toThrow("already being modified");
    expect(() => ownership.acquire("root-2", "movies/ABC-001.mp4")).not.toThrow();

    release();
    expect(() => ownership.acquire("root-1", "movies/ABC-001.mp4")).not.toThrow();
  });

  it("rejects paths that escape their root", () => {
    const ownership = new MediaPathOwnership();
    expect(() => ownership.acquire("root-1", "../outside.mp4")).toThrow("Invalid media relative path");
  });

  it("acquires every ref all-or-nothing in sorted order", () => {
    const ownership = new MediaPathOwnership();
    const releaseFirst = ownership.acquire("root-1", "b.mp4");

    expect(() =>
      ownership.acquireAll([
        { rootId: "root-1", relativePath: "a.mp4" },
        { rootId: "root-1", relativePath: "b.mp4" },
      ]),
    ).toThrow("already being modified");

    const releaseA = ownership.acquire("root-1", "a.mp4");
    releaseA();
    releaseFirst();
    const releaseAll = ownership.acquireAll([
      { rootId: "root-2", relativePath: "z.mp4" },
      { rootId: "root-1", relativePath: "a.mp4" },
    ]);
    expect(() => ownership.acquire("root-1", "a.mp4")).toThrow("already being modified");
    expect(() => ownership.acquire("root-2", "z.mp4")).toThrow("already being modified");
    releaseAll();
  });

  it("allows one operation to extend its reservation without exposing paths during nested release", () => {
    const ownership = new MediaPathOwnership();
    const releaseSession = ownership.acquire("root-1", "video.mp4", "maintenance-1");
    const releasePublication = ownership.acquireAll(
      [
        { rootId: "root-1", relativePath: "video.mp4" },
        { rootId: "root-1", relativePath: "video.nfo" },
      ],
      "maintenance-1",
    );

    releasePublication();
    expect(() => ownership.acquire("root-1", "video.mp4")).toThrow("already being modified");
    expect(() => ownership.acquire("root-1", "video.nfo")).not.toThrow();
    releaseSession();
    expect(() => ownership.acquire("root-1", "video.mp4")).not.toThrow();
  });
});
