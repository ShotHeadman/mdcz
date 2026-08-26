import { describe, expect, it } from "vitest";
import { createDesktopInputRoot, deterministicMediaRootId } from "./desktopInputRoot";

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
});
