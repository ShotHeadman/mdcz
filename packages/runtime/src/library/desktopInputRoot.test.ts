import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDesktopInputRoot, deterministicMediaRootId, resolveDesktopInputRootPath } from "./desktopInputRoot";

describe("desktop input root", () => {
  it("derives a stable id from the normalized host path", () => {
    const first = createDesktopInputRoot("/media/library/../library");
    const second = createDesktopInputRoot("/media/library");
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
});
