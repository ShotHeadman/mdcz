import { describe, expect, it } from "vitest";
import { isTrustedRendererUrl } from "./rendererTrust";

describe("renderer trust", () => {
  it.each([
    ["mdcz-api://app/overview", true],
    ["mdcz-api://app/", true],
    ["mdcz-api://other/overview", false],
    ["http://localhost:5173/overview", false],
    ["https://evil.example/", false],
    ["file:///tmp/renderer/index.html", false],
    ["", false],
  ])("trusts %s: %s", (url, trusted) => {
    expect(isTrustedRendererUrl(url)).toBe(trusted);
  });
});
