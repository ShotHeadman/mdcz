import { afterEach, describe, expect, it } from "vitest";
import { closeTestServers, createTestServer } from "./app.testSupport";

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
    const loginResponse = await fastify.inject({
      method: "POST",
      url: "/trpc/auth.login",
      payload: { password: "admin" },
    });
    const token = loginResponse.json().result.data.token;

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

  it("exposes auth setup state before login", async () => {
    const { fastify } = await createTestServer();

    const response = await fastify.inject({ method: "GET", url: "/trpc/auth.setup" });

    expect(response.statusCode).toBe(200);
    expect(response.json().result.data).toEqual({
      authenticated: false,
      setupRequired: true,
      usingDefaultPassword: true,
    });
  });
});
