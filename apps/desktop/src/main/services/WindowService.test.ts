import { describe, expect, it } from "vitest";
import { buildRendererContentSecurityPolicy, denyWindowOpen, isRendererNavigationAllowed } from "./WindowService";

describe("WindowService isolation", () => {
  it("denies window.open", () => {
    expect(denyWindowOpen()).toEqual({ action: "deny" });
  });

  it("denies navigation off the app origin", () => {
    expect(isRendererNavigationAllowed("https://evil.example/", "http://localhost:5173")).toBe(false);
    expect(isRendererNavigationAllowed("http://localhost:5173/library", "http://localhost:5173")).toBe(true);
    expect(isRendererNavigationAllowed("file:///tmp/renderer/index.html")).toBe(true);
    expect(isRendererNavigationAllowed("file:///etc/passwd")).toBe(false);
  });

  it("adds only the Vite renderer and websocket origins in development", () => {
    const csp = buildRendererContentSecurityPolicy("http://localhost:5173");
    expect(csp).toContain("script-src 'self' http://localhost:5173");
    expect(csp).toContain("connect-src 'self' http://localhost:5173 ws://localhost:5173");
    expect(csp).toContain("img-src 'self' local-file:");
    expect(buildRendererContentSecurityPolicy(undefined)).toContain("script-src 'self'");
    expect(buildRendererContentSecurityPolicy(undefined)).not.toContain("ws://");
  });
});
