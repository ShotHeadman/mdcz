import { describe, expect, it } from "vitest";
import { LOCAL_FILE_SCHEME, parseLocalFileUrl, toLocalFileUrl } from "./mediaRef";

describe("local-file URL encoding", () => {
  it("round-trips a RootFileRef", () => {
    const url = toLocalFileUrl({ rootId: "root-1", relativePath: "Actor A/ABC-123/poster.jpg" });
    expect(url.startsWith(`${LOCAL_FILE_SCHEME}://`)).toBe(true);
    expect(parseLocalFileUrl(url)).toEqual({
      rootId: "root-1",
      relativePath: "Actor A/ABC-123/poster.jpg",
    });
  });

  it("rejects traversal in the relative path", () => {
    expect(() => toLocalFileUrl({ rootId: "root-1", relativePath: "../secret.txt" })).toThrow(
      "Invalid media relative path",
    );
    expect(() => parseLocalFileUrl("local-file://root-1/foo/%2e%2e/%2e%2e/secret.txt")).toThrow(
      "Invalid media relative path",
    );
    expect(() => parseLocalFileUrl("local-file://root-1/foo/../secret.txt")).toThrow("Invalid media relative path");
  });
});
