import { extractNumber, parseFileInfo } from "@main/utils/number";
import { describe, expect, it } from "vitest";

describe("extractNumber", () => {
  it("extracts canonical numbers after stripping naming suffixes", () => {
    const cases = [
      { input: "ABC-123-C-CD1", expected: "ABC-123" },
      { input: "ABC-123-中文字幕", expected: "ABC-123" },
      { input: "FC2-PPV-123456-U", expected: "FC2-123456" },
      { input: "FC2-123456-1", expected: "FC2-123456" },
      { input: "FC2-123456-4", expected: "FC2-123456" },
      { input: "FC2-123456-前番", expected: "FC2-123456" },
      { input: "IDBD-905-4", expected: "IDBD-905" },
      { input: "123-456", expected: "123-456" },
    ];

    for (const { input, expected } of cases) {
      expect(extractNumber(input)).toBe(expected);
    }
  });
});

describe("parseFileInfo", () => {
  it("parses multipart suffixes and preserves their raw text", () => {
    expect(parseFileInfo("/tmp/ABC-123-C-CD1.mkv")).toMatchObject({
      number: "ABC-123",
      isSubtitled: true,
      subtitleTag: "中文字幕",
      part: {
        number: 1,
        suffix: "-CD1",
      },
    });

    expect(parseFileInfo("/tmp/FC2-123456-1.mp4")).toMatchObject({
      number: "FC2-123456",
      part: {
        number: 1,
        suffix: "-1",
      },
    });

    expect(parseFileInfo("/tmp/FC2-123456-1080p-1.mp4")).toMatchObject({
      number: "FC2-123456",
      part: {
        number: 1,
        suffix: "-1",
      },
      resolution: "1080P",
    });

    expect(parseFileInfo("/tmp/FC2-123456-前番.mp4")).toMatchObject({
      number: "FC2-123456",
      part: {
        number: 1,
        suffix: "-前番",
      },
    });

    expect(parseFileInfo("/tmp/ABC-123-PART1.MP4")).toMatchObject({
      extension: ".MP4",
      part: {
        number: 1,
        suffix: "-PART1",
      },
    });

    expect(parseFileInfo("/tmp/FC2-123456-1-中文字幕.mp4")).toMatchObject({
      number: "FC2-123456",
      isSubtitled: true,
      subtitleTag: "中文字幕",
      part: {
        number: 1,
        suffix: "-1",
      },
    });

    expect(parseFileInfo("/tmp/FC2-123456-4-中文字幕.mp4")).toMatchObject({
      number: "FC2-123456",
      isSubtitled: true,
      subtitleTag: "中文字幕",
      part: {
        number: 4,
        suffix: "-4",
      },
    });

    expect(parseFileInfo("/tmp/IDBD-905-4.mkv")).toMatchObject({
      number: "IDBD-905",
      part: {
        number: 4,
        suffix: "-4",
      },
    });
  });

  it("distinguishes uncensored and subtitle suffixes and keeps resolution metadata", () => {
    expect(parseFileInfo("/tmp/ABC-123-U-1080p.mp4")).toMatchObject({
      number: "ABC-123",
      isUncensored: true,
      isSubtitled: false,
      resolution: "1080P",
    });

    expect(parseFileInfo("/tmp/ABC-123-UC.mp4")).toMatchObject({
      number: "ABC-123",
      isUncensored: true,
      isSubtitled: true,
      subtitleTag: "中文字幕",
    });
  });

  it("recognizes expanded subtitle markers in filenames", () => {
    for (const input of [
      "/tmp/ABC-123-中文字幕.mp4",
      "/tmp/ABC-123_中文字幕.mkv",
      "/tmp/ABC-123中字.mp4",
      "/tmp/ABC-123-CHS.mp4",
    ]) {
      expect(parseFileInfo(input)).toMatchObject({
        number: "ABC-123",
        isSubtitled: true,
        subtitleTag: "中文字幕",
      });
    }

    expect(parseFileInfo("/tmp/ABC-123-中文字幕.mp4")).toMatchObject({
      isUncensored: false,
    });

    for (const input of [
      "/tmp/ABC-123-中英字幕.mp4",
      "/tmp/ABC-123-繁中.mp4",
      "/tmp/ABC-123-CHT.mp4",
      "/tmp/ABC-123-SUB.mp4",
    ]) {
      expect(parseFileInfo(input)).toMatchObject({
        number: "ABC-123",
        isSubtitled: false,
        subtitleTag: undefined,
      });
    }
  });

  it("does not misread numeric identifiers as bare multipart suffixes", () => {
    expect(parseFileInfo("/tmp/123-456.mp4")).toMatchObject({
      number: "123-456",
      part: undefined,
    });

    expect(parseFileInfo("/tmp/FC2-123456-10.mp4")).toMatchObject({
      number: "FC2-123456",
      part: undefined,
    });

    expect(parseFileInfo("/tmp/IDBD-905-12.mkv")).toMatchObject({
      number: "IDBD-905",
      part: undefined,
    });
  });
});
