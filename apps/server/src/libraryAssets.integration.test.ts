import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeTestServers,
  createTempRoot,
  createTestServer,
  loginAsAdmin,
  syncMediaRootFromConfig,
} from "./app.testSupport";

afterEach(async () => {
  await closeTestServers();
});

const createImage = async (width: number, height: number, red: number): Promise<Buffer> =>
  await sharp({
    create: {
      background: { alpha: 1, b: 48, g: 96, r: red },
      channels: 4,
      height,
      width,
    },
  })
    .png()
    .toBuffer();

const createAssetFixture = async () => {
  const root = await createTempRoot("library-assets");
  const relativePath = "movies/ABC-001/poster.png";
  const sourcePath = join(root, relativePath);
  const source = await createImage(320, 180, 160);
  await mkdir(join(root, "movies", "ABC-001"), { recursive: true });
  await writeFile(sourcePath, source);
  const { fastify } = await createTestServer();
  const token = await loginAsAdmin(fastify);
  const rootId = await syncMediaRootFromConfig(fastify, token, root);
  const url = `/api/library/assets/${encodeURIComponent(rootId)}/${relativePath}`;
  return { fastify, relativePath, rootId, source, sourcePath, token, url };
};

describe("library asset HTTP representations", () => {
  it("streams the original and honors its ETag", async () => {
    const fixture = await createAssetFixture();
    const response = await fixture.fastify.inject({
      method: "GET",
      url: fixture.url,
      headers: { authorization: `Bearer ${fixture.token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.headers.etag).toEqual(expect.any(String));
    expect(response.headers["last-modified"]).toEqual(expect.any(String));
    expect(response.rawPayload).toEqual(fixture.source);

    const notModified = await fixture.fastify.inject({
      method: "GET",
      url: fixture.url,
      headers: {
        authorization: `Bearer ${fixture.token}`,
        "if-none-match": response.headers.etag,
      },
    });
    expect(notModified.statusCode).toBe(304);
    expect(notModified.rawPayload).toHaveLength(0);

    const weakOrMultiple = await fixture.fastify.inject({
      method: "GET",
      url: fixture.url,
      headers: {
        authorization: `Bearer ${fixture.token}`,
        "if-none-match": `"unrelated", W/${response.headers.etag}`,
      },
    });
    expect(weakOrMultiple.statusCode).toBe(304);

    const notModifiedSince = await fixture.fastify.inject({
      method: "GET",
      url: fixture.url,
      headers: {
        authorization: `Bearer ${fixture.token}`,
        "if-modified-since": response.headers["last-modified"],
      },
    });
    expect(notModifiedSince.statusCode).toBe(304);

    const etagTakesPrecedence = await fixture.fastify.inject({
      method: "GET",
      url: fixture.url,
      headers: {
        authorization: `Bearer ${fixture.token}`,
        "if-modified-since": response.headers["last-modified"],
        "if-none-match": '"unrelated"',
      },
    });
    expect(etagTakesPrecedence.statusCode).toBe(200);

    const revised = await fixture.fastify.inject({
      method: "GET",
      url: `${fixture.url}?revision=crop-2`,
      headers: {
        authorization: `Bearer ${fixture.token}`,
        "if-none-match": response.headers.etag,
      },
    });
    expect(revised.statusCode).toBe(200);
    expect(revised.headers.etag).not.toBe(response.headers.etag);
  });

  it("caches bounded variants and invalidates them by revision or source metadata", async () => {
    const fixture = await createAssetFixture();
    const variantUrl = `${fixture.url}?w=120&format=webp`;
    const first = await fixture.fastify.inject({
      method: "GET",
      url: variantUrl,
      headers: { authorization: `Bearer ${fixture.token}` },
    });
    const cached = await fixture.fastify.inject({
      method: "GET",
      url: variantUrl,
      headers: { authorization: `Bearer ${fixture.token}` },
    });
    const metadata = await sharp(first.rawPayload).metadata();

    expect(first.statusCode).toBe(200);
    expect(first.headers["content-type"]).toContain("image/webp");
    expect(metadata).toMatchObject({ format: "webp", width: 120 });
    expect(cached.headers.etag).toBe(first.headers.etag);
    expect(cached.rawPayload).toEqual(first.rawPayload);

    const revised = await fixture.fastify.inject({
      method: "GET",
      url: `${variantUrl}&revision=crop-2`,
      headers: { authorization: `Bearer ${fixture.token}` },
    });
    expect(revised.headers.etag).not.toBe(first.headers.etag);

    await writeFile(fixture.sourcePath, await createImage(400, 200, 220));
    const modified = await fixture.fastify.inject({
      method: "GET",
      url: variantUrl,
      headers: { authorization: `Bearer ${fixture.token}` },
    });
    expect(modified.headers.etag).not.toBe(first.headers.etag);
    expect(await sharp(modified.rawPayload).metadata()).toMatchObject({ format: "webp", height: 60, width: 120 });
  });

  it("rejects unauthenticated, escaping, and invalid variant requests", async () => {
    const fixture = await createAssetFixture();
    const unauthorized = await fixture.fastify.inject({ method: "GET", url: fixture.url });
    const escaping = await fixture.fastify.inject({
      method: "GET",
      url: `/api/library/assets/${encodeURIComponent(fixture.rootId)}/..%2Fconfig%2Fdefault.png`,
      headers: { authorization: `Bearer ${fixture.token}` },
    });
    const invalidWidth = await fixture.fastify.inject({
      method: "GET",
      url: `${fixture.url}?w=63&format=webp`,
      headers: { authorization: `Bearer ${fixture.token}` },
    });
    const invalidFormat = await fixture.fastify.inject({
      method: "GET",
      url: `${fixture.url}?w=120&format=jpeg`,
      headers: { authorization: `Bearer ${fixture.token}` },
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(escaping.statusCode).toBe(400);
    expect(invalidWidth.statusCode).toBe(400);
    expect(invalidFormat.statusCode).toBe(400);
  });
});
