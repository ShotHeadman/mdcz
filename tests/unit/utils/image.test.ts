import { describe, expect, it } from "vitest";
import { buildImageSourceCandidates, getImageSrc, normalizeImageSourcePath } from "@/utils/image";

describe("image utils", () => {
  it("builds remote, sibling-local, and empty image source candidates", () => {
    const cases = [
      {
        input: {
          remotePath: "https://img.example.com/poster.jpg",
          outputPath: "/tmp/out",
          fileName: "poster.jpg",
        },
        expected: {
          primary: "https://img.example.com/poster.jpg",
          fallback: "/tmp/out/poster.jpg",
        },
      },
      {
        input: {
          filePath: "D:\\videos\\MIDE-001.mp4",
          fileName: "thumb.jpg",
        },
        expected: {
          primary: "D:\\videos\\thumb.jpg",
          fallback: "D:\\videos\\thumb.jpg",
        },
      },
      {
        input: {
          remotePath: "poster.jpg",
          outputPath: "/tmp/out",
          fileName: "poster.jpg",
        },
        expected: {
          primary: "/tmp/out/poster.jpg",
          fallback: "/tmp/out/poster.jpg",
        },
      },
      {
        input: {
          remotePath: "extrafanart/scene1.jpg",
          outputPath: "/tmp/out",
          fileName: "thumb.jpg",
        },
        expected: {
          primary: "/tmp/out/extrafanart/scene1.jpg",
          fallback: "/tmp/out/thumb.jpg",
        },
      },
      {
        input: {
          fileName: "poster.jpg",
        },
        expected: {
          primary: "",
          fallback: "",
        },
      },
    ];

    for (const { input, expected } of cases) {
      expect(buildImageSourceCandidates(input)).toEqual(expected);
    }
  });

  it("normalizes wrapped local image paths from file and crop endpoints", () => {
    const cases = [
      {
        input: "http://localhost/api/v1/files/image?path=%2Ftmp%2Fcovers%2Fposter.jpg",
        expected: "/tmp/covers/poster.jpg",
      },
      {
        input: "http://localhost/api/v1/crop/image?path=%2Ftmp%2Fcovers%2Fposter%201.jpg",
        expected: "/tmp/covers/poster 1.jpg",
      },
    ];

    for (const { input, expected } of cases) {
      expect(normalizeImageSourcePath(input)).toBe(expected);
    }
  });

  it("keeps supported remote sources and converts local paths to local-file urls", () => {
    const cases = [
      {
        input: "https://img.example.com/thumb.jpg",
        expected: "https://img.example.com/thumb.jpg",
      },
      {
        input: "data:image/png;base64,AAAA",
        expected: "data:image/png;base64,AAAA",
      },
      {
        input: "blob:https://localhost/abc",
        expected: "blob:https://localhost/abc",
      },
      {
        input: "C:\\covers\\poster.jpg",
        expected: "local-file:///C:/covers/poster.jpg",
      },
      {
        input: "/home/user/covers/poster.jpg",
        expected: "local-file:///home/user/covers/poster.jpg",
      },
      {
        input: "javascript:void(0)",
        expected: "",
      },
      {
        input: "about:blank",
        expected: "",
      },
    ];

    for (const { input, expected } of cases) {
      expect(getImageSrc(input)).toBe(expected);
    }
  });
});
