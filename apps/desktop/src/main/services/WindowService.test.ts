import { describe, expect, it } from "vitest";
import { buildRendererContentSecurityPolicy } from "./WindowService";

describe("WindowService isolation", () => {
  it("adds only the Vite renderer and websocket origins in development", () => {
    const csp = buildRendererContentSecurityPolicy("http://localhost:5173");
    expect(csp).toContain("script-src 'self' http://localhost:5173");
    expect(csp).toContain("connect-src 'self' http://localhost:5173 ws://localhost:5173");
    expect(csp).toContain("img-src 'self' local-file:");
    expect(buildRendererContentSecurityPolicy(undefined)).toContain("script-src 'self'");
    expect(buildRendererContentSecurityPolicy(undefined)).not.toContain("ws://");
  });
});
