import { buildSafeFileName, buildSafePath } from "@main/utils/path";
import { describe, expect, it } from "vitest";

const splitSegments = (value: string): string[] => value.split(/[\\/]+/u).filter((segment) => segment.length > 0);

describe("path template helpers", () => {
  it("treats only template-authored separators as folder boundaries", () => {
    const built = buildSafePath("{actor}/{title}", {
      actor: "Unknown",
      title: "しょ\\う動物系/ペットショップ店員",
    });

    expect(splitSegments(built)).toEqual(["Unknown", "しょ-う動物系-ペットショップ店員"]);
  });

  it("keeps template literal backslashes working as folder separators for compatibility", () => {
    const built = buildSafePath("{actor}\\{number}", {
      actor: "Unknown",
      number: "FC2-4532163",
    });

    expect(splitSegments(built)).toEqual(["Unknown", "FC2-4532163"]);
  });

  it("drops empty optional bracket groups instead of leaving stray [] in names", () => {
    const built = buildSafePath("{actor}[{series}][{number}] {title}", {
      actor: "Unknown",
      number: "FC2-4532163",
      title: "Sample Title",
    });

    expect(built).toBe("Unknown[FC2-4532163] Sample Title");
  });

  it("trims dangling separators inside optional groups before wrapping them", () => {
    expect(
      buildSafeFileName("[{studio} - {series}] {number}", {
        series: "Series",
        number: "FC2-4532163",
      }),
    ).toBe("[Series] FC2-4532163");

    expect(
      buildSafeFileName("[{studio} - {series}] {number}", {
        studio: "Studio",
        number: "FC2-4532163",
      }),
    ).toBe("[Studio] FC2-4532163");

    expect(
      buildSafeFileName("[{studio} - {series}] {number}", {
        studio: "Studio",
        series: "Series",
        number: "FC2-4532163",
      }),
    ).toBe("[Studio - Series] FC2-4532163");
  });

  it("sanitizes file-template placeholder values without creating path separators", () => {
    const built = buildSafeFileName("[{series}]{number} {title}", {
      number: "FC2-4532163",
      title: "しょ\\う/おか\\ね",
    });

    expect(built).toBe("FC2-4532163 しょ-う-おか-ね");
  });
});
