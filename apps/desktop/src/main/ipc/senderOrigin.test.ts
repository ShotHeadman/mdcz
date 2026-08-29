import { describe, expect, it } from "vitest";
import { assertAllowedIpcSender, isAllowedIpcSenderUrl } from "./senderOrigin";

describe("IPC sender origin", () => {
  it("allows the packaged file renderer even when URL.origin is opaque", () => {
    expect(new URL("file:///tmp/renderer/index.html").origin).toBe("null");
    expect(isAllowedIpcSenderUrl("file:///tmp/renderer/index.html", undefined)).toBe(true);
  });

  it("rejects a foreign origin and missing sender URL", () => {
    expect(isAllowedIpcSenderUrl("https://evil.example/", undefined)).toBe(false);
    expect(isAllowedIpcSenderUrl("local-file://root-1/poster.jpg", undefined)).toBe(false);
    expect(() => assertAllowedIpcSender({ sender: {} as never, senderFrame: null }, undefined)).toThrow(
      "IPC sender origin is not allowed",
    );
  });

  it("allows only the Vite renderer origin in development", () => {
    expect(isAllowedIpcSenderUrl("http://localhost:5173/overview", "http://localhost:5173")).toBe(true);
    expect(isAllowedIpcSenderUrl("http://localhost:5173/library", "http://localhost:5173")).toBe(true);
    expect(isAllowedIpcSenderUrl("https://evil.example/", "http://localhost:5173")).toBe(false);
    expect(isAllowedIpcSenderUrl("file:///tmp/renderer/index.html", "http://localhost:5173")).toBe(false);
  });
});
