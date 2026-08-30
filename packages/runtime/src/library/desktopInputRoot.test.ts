import path from "node:path";
import { createMediaRoot, deterministicMediaRootId, findEnclosingMediaRoot } from "@mdcz/media-store";
import { describe, expect, it } from "vitest";
import { resolveDesktopInputRootPath } from "./desktopInputRoot";

describe("desktop input root", () => {
  it("derives a stable id from the normalized host path", () => {
    const first = createMediaRoot({
      id: deterministicMediaRootId("/media/library/../library"),
      displayName: "library",
      hostPath: "/media/library/../library",
    });
    const second = createMediaRoot({
      id: deterministicMediaRootId("/media/library"),
      displayName: "library",
      hostPath: "/media/library",
    });
    expect(first.id).toBe(second.id);
    expect(deterministicMediaRootId(first.hostPath)).toBe(first.id);
  });

  it("changes identity when the host path changes", () => {
    expect(deterministicMediaRootId("/media/a")).not.toBe(deterministicMediaRootId("/media/b"));
  });

  it("uses a containing preferred root or falls back to the common parent", () => {
    const base = path.resolve("media-root-test");
    const files = [path.join(base, "a", "one.mp4"), path.join(base, "b", "two.mp4")];
    expect(resolveDesktopInputRootPath(files, base)).toBe(base);
    expect(resolveDesktopInputRootPath(files, path.join(base, "a"))).toBe(base);
    expect(() => resolveDesktopInputRootPath([], base)).toThrow("Cannot create a scrape root without files");
  });

  it("reuses the longest enclosing root and ignores unrelated paths", () => {
    const library = createMediaRoot({ displayName: "library", hostPath: "/media/library" });
    const nested = createMediaRoot({ displayName: "shows", hostPath: "/media/library/shows" });
    const other = createMediaRoot({ displayName: "other", hostPath: "/media/other" });
    expect(findEnclosingMediaRoot("/media/library/shows/S01/episode.mp4", [library, nested, other])).toBe(nested);
    expect(findEnclosingMediaRoot("/media/library/movie.mp4", [library, other])).toBe(library);
    expect(findEnclosingMediaRoot("/tmp/outside.mp4", [library, other])).toBeUndefined();
  });
});
