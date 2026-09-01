import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { resolvePackagedRendererPath } from "../rendererTrust";
import { assertAllowedIpcSender, isAllowedIpcSenderUrl } from "./senderOrigin";

describe("IPC sender origin", () => {
  it("allows only the exact packaged renderer file", () => {
    const rendererUrl = `${pathToFileURL(resolvePackagedRendererPath()).href}#/overview`;
    expect(new URL(rendererUrl).origin).toBe("null");
    expect(isAllowedIpcSenderUrl(rendererUrl, undefined)).toBe(true);
    expect(isAllowedIpcSenderUrl(pathToFileURL("/tmp/renderer/index.html").href, undefined)).toBe(false);
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
    expect(isAllowedIpcSenderUrl(pathToFileURL("/tmp/renderer/index.html").href, "http://localhost:5173")).toBe(false);
  });
});
