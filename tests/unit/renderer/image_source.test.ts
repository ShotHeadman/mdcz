import { toLocalFileUrl } from "@mdcz/shared/mediaRef";
import { describe, expect, it } from "vitest";
import { getImageSrc, getLocalImagePath, normalizeImageSourcePath } from "@/utils/image";

describe("desktop image sources", () => {
  it("keeps root-scoped local-file URLs renderable", () => {
    const url = toLocalFileUrl({ rootId: "media", relativePath: "ABC-123/poster.jpg" });

    expect(normalizeImageSourcePath(url)).toBe(url);
    expect(getLocalImagePath(url)).toBe("");
    expect(getImageSrc(url)).toBe(url);
  });
});
