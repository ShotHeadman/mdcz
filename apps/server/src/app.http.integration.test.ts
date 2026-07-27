import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./app";
import { closeTestServers, createTempRoot, createTestServer, loginAsAdmin } from "./app.testSupport";

const expectedHealthPayload = {
  service: "mdcz-server",
  status: "ok",
  slice: "app-skeleton",
} as const;

afterEach(async () => {
  await closeTestServers();
});

describe("buildServer HTTP integration", () => {
  it("preserves the root and health HTTP contracts", async () => {
    const { fastify } = await createTestServer();

    const rootResponse = await fastify.inject({ method: "GET", url: "/" });
    const healthResponse = await fastify.inject({ method: "GET", url: "/health" });

    expect(rootResponse.statusCode).toBe(200);
    expect(rootResponse.json()).toEqual(expectedHealthPayload);
    expect(healthResponse.statusCode).toBe(200);
    expect(healthResponse.json()).toEqual(expectedHealthPayload);
  });

  it("mounts a tRPC health procedure", async () => {
    const { fastify } = await createTestServer();

    const response = await fastify.inject({ method: "GET", url: "/trpc/health.read" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      result: {
        data: expectedHealthPayload,
      },
    });
  });

  it("returns a localized error for invalid admin login", async () => {
    const { fastify } = await createTestServer();

    const response = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "wrong-password" },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.message).toContain("管理员密码错误");
  });

  it("exposes server and Web build metadata through system.about", async () => {
    const { fastify } = await createTestServer();
    const token = await loginAsAdmin(fastify);

    const response = await fastify.inject({
      method: "GET",
      url: "/trpc/system.about",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result.data).toMatchObject({
      productName: "MDCz",
      community: {
        feedback: { url: "https://github.com/ShotHeadman/mdcz/issues/new/choose" },
      },
      build: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
    });
    expect(response.json().result.data.version).toEqual(expect.any(String));
  });

  it("allows WebUI dev origins to preflight tRPC requests", async () => {
    const { fastify } = await createTestServer();

    const response = await fastify.inject({
      method: "OPTIONS",
      url: "/trpc/auth.login",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-headers": "content-type,authorization",
        "access-control-request-method": "POST",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
    expect(response.headers["access-control-allow-headers"]).toContain("authorization");
  });

  it("handles LAN development origins only when the host matches", async () => {
    const { fastify } = await createTestServer();
    const request = {
      method: "OPTIONS" as const,
      url: "/trpc/auth.login",
      headers: {
        origin: "http://192.168.1.20:5173",
        host: "192.168.1.20:3838",
      },
    };

    const matching = await fastify.inject(request);
    expect(matching.headers["access-control-allow-origin"]).toBe(request.headers.origin);

    const mismatched = await fastify.inject({
      ...request,
      headers: { ...request.headers, host: "192.168.1.21:3838" },
    });
    expect(mismatched.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("exposes auth setup state before login", async () => {
    const { fastify } = await createTestServer();

    const response = await fastify.inject({ method: "GET", url: "/trpc/auth.setup" });

    expect(response.statusCode).toBe(200);
    expect(response.json().result.data).toEqual({
      authenticated: false,
      setupRequired: true,
      usingDefaultPassword: true,
      environmentPasswordConfigured: false,
    });
  });

  it("returns not found for unknown routes", async () => {
    const { fastify } = await createTestServer();

    const response = await fastify.inject({ method: "GET", url: "/unknown" });

    expect(response.statusCode).toBe(404);
  });

  it("serves the WebUI static bundle and falls back to index.html for routes", async () => {
    const webRoot = await createTempRoot("web-static");
    await writeFile(join(webRoot, "index.html"), '<!doctype html><div id="root"></div>', "utf8");
    await writeFile(join(webRoot, "app.js"), "console.log('web')", "utf8");
    const { fastify } = buildServer({ webStaticDir: webRoot });

    try {
      const assetResponse = await fastify.inject({ method: "GET", url: "/app.js" });
      const routeResponse = await fastify.inject({ method: "GET", url: "/settings" });
      const rootResponse = await fastify.inject({ method: "GET", url: "/" });

      expect(assetResponse.statusCode).toBe(200);
      expect(assetResponse.headers["content-type"]).toContain("text/javascript");
      expect(assetResponse.body).toBe("console.log('web')");
      expect(routeResponse.statusCode).toBe(200);
      expect(routeResponse.headers["content-type"]).toContain("text/html");
      expect(routeResponse.body).toContain('<div id="root"></div>');
      expect(rootResponse.statusCode).toBe(200);
      expect(rootResponse.headers["content-type"]).toContain("text/html");
      expect(rootResponse.body).toContain('<div id="root"></div>');
    } finally {
      await fastify.close();
    }
  });
});
