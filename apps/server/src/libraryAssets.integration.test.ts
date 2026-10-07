import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { closeTestServers, createTempRoot, createTestLibrary, createTestServer, loginAsAdmin } from "./app.testSupport";

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
  const { rootId } = await createTestLibrary(fastify, token, root);
  const url = `/api/library/assets/${encodeURIComponent(rootId)}/${relativePath}`;
  return { fastify, relativePath, rootId, source, sourcePath, token, url };
};

describe("library asset HTTP representations", () => {
  it("serves local trailers with byte ranges for seeking and honors If-Range", async () => {
    const fixture = await createAssetFixture();
    const source = Buffer.from("0123456789");
    await writeFile(join(fixture.sourcePath, "..", "trailer.mp4"), source);
    const url = fixture.url.replace("poster.png", "trailer.mp4");
    const headers = { authorization: `Bearer ${fixture.token}` };
    const original = await fixture.fastify.inject({ method: "GET", url, headers });
    expect(original.statusCode).toBe(200);
    expect(original.headers["content-type"]).toContain("video/mp4");
    expect(original.headers["accept-ranges"]).toBe("bytes");
    expect(original.rawPayload).toEqual(source);
    for (const [range, start, end] of [
      ["bytes=2-5", 2, 5],
      ["bytes=6-", 6, 9],
      ["bytes=-3", 7, 9],
      ["bytes=8-99", 8, 9],
    ] as const) {
      const response = await fixture.fastify.inject({
        method: "GET",
        url,
        headers: { ...headers, range, "if-range": original.headers.etag },
      });
      expect(response.statusCode).toBe(206);
      expect(response.headers["content-range"]).toBe(`bytes ${start}-${end}/10`);
      expect(response.headers["content-length"]).toBe(String(end - start + 1));
      expect(response.rawPayload).toEqual(source.subarray(start, end + 1));
    }
    for (const range of ["bytes=10-", "bytes=-0", "bytes=5-2"]) {
      const response = await fixture.fastify.inject({ method: "GET", url, headers: { ...headers, range } });
      expect(response.statusCode).toBe(416);
      expect(response.headers["content-range"]).toBe("bytes */10");
    }
    const changed = await fixture.fastify.inject({
      method: "GET",
      url,
      headers: { ...headers, range: "bytes=2-5", "if-range": '"outdated"' },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.rawPayload).toEqual(source);
    const head = await fixture.fastify.inject({ method: "HEAD", url, headers });
    expect(head.headers["content-length"]).toBe("10");
    expect(head.rawPayload).toHaveLength(0);
    expect((await fixture.fastify.inject({ method: "GET", url: `${url}?w=120&format=webp`, headers })).statusCode).toBe(
      400,
    );
  });

  it("streams the original and honors its ETag", async () => {
    const fixture = await createAssetFixture();
    const response = await fixture.fastify.inject({
      method: "GET",
      url: fixture.url,
      headers: { authorization: `Bearer ${fixture.token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.rawPayload).toEqual(fixture.source);

    for (const { headers, revision, status } of [
      { headers: { "if-none-match": response.headers.etag }, status: 304 },
      { headers: { "if-none-match": `"unrelated", W/${response.headers.etag}` }, status: 304 },
      { headers: { "if-modified-since": response.headers["last-modified"] }, status: 304 },
      {
        headers: { "if-modified-since": response.headers["last-modified"], "if-none-match": '"unrelated"' },
        status: 200,
      },
      { headers: { "if-none-match": response.headers.etag }, revision: "crop-2", status: 200 },
    ]) {
      const cached = await fixture.fastify.inject({
        method: "GET",
        url: revision ? `${fixture.url}?revision=${revision}` : fixture.url,
        headers: { authorization: `Bearer ${fixture.token}`, ...headers },
      });
      expect(cached.statusCode).toBe(status);
      expect(cached.rawPayload).toEqual(status === 304 ? Buffer.alloc(0) : fixture.source);
      if (revision) expect(cached.headers.etag).not.toBe(response.headers.etag);
    }
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
    for (const query of ["w=63&format=webp", "w=120&format=jpeg"]) {
      const invalid = await fixture.fastify.inject({
        method: "GET",
        url: `${fixture.url}?${query}`,
        headers: { authorization: `Bearer ${fixture.token}` },
      });
      expect(invalid.statusCode).toBe(400);
    }
  });
});
