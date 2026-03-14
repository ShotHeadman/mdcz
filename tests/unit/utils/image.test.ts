import { describe, expect, it } from "vitest";
import { buildImageSourceCandidates, getImageSrc, normalizeImageSourcePath } from "@/utils/image";

describe("image utils", () => {
  it("prefers remote source and keeps local fallback", () => {
    const result = buildImageSourceCandidates({
      remotePath: "https://img.example.com/poster.jpg",
      outputPath: "/tmp/out",
      fileName: "poster.jpg",
    });

    expect(result.primary).toBe("https://img.example.com/poster.jpg");
    expect(result.fallback).toBe("/tmp/out/poster.jpg");
  });

  it("builds sibling fallback when output path is missing", () => {
    const result = buildImageSourceCandidates({
      filePath: "D:\\videos\\MIDE-001.mp4",
      fileName: "thumb.jpg",
    });

    expect(result.primary).toBe("D:\\videos\\thumb.jpg");
    expect(result.fallback).toBe("D:\\videos\\thumb.jpg");
  });

  it("extracts local path from file-api wrapper url", () => {
    const wrapped = "http://localhost/api/v1/files/image?path=%2Ftmp%2Fcovers%2Fposter.jpg";

    expect(normalizeImageSourcePath(wrapped)).toBe("/tmp/covers/poster.jpg");
  });

  it("extracts and decodes local path from crop wrapper url", () => {
    const wrapped = "http://localhost/api/v1/crop/image?path=%2Ftmp%2Fcovers%2Fposter%201.jpg";

    expect(normalizeImageSourcePath(wrapped)).toBe("/tmp/covers/poster 1.jpg");
  });

  it("returns empty candidates when no remote or local source exists", () => {
    const result = buildImageSourceCandidates({
      fileName: "poster.jpg",
    });

    expect(result.primary).toBe("");
    expect(result.fallback).toBe("");
  });

  it("keeps remote urls unchanged and converts local paths to local-file urls", () => {
    expect(getImageSrc("https://img.example.com/thumb.jpg")).toBe("https://img.example.com/thumb.jpg");
    expect(getImageSrc("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(getImageSrc("blob:https://localhost/abc")).toBe("blob:https://localhost/abc");
    expect(getImageSrc("C:\\covers\\poster.jpg")).toBe("local-file:///C:/covers/poster.jpg");
    expect(getImageSrc("/home/user/covers/poster.jpg")).toBe("local-file:///home/user/covers/poster.jpg");
  });

  it("drops unsupported explicit schemes instead of treating them as file paths", () => {
    expect(getImageSrc("javascript:void(0)")).toBe("");
    expect(getImageSrc("about:blank")).toBe("");
  });
});
