import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectImageFormat, parseImageDimensions, validateImage } from "./image";

const pngBytes = (width: number, height: number): Buffer => {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
};

const jpegBytes = (width: number, height: number): Buffer =>
  Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x07,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
  ]);

const webpBytes = (width: number, height: number): Buffer => {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, "ascii");
  bytes.write("WEBP", 8, "ascii");
  bytes.write("VP8X", 12, "ascii");
  bytes.writeUIntLE(width - 1, 24, 3);
  bytes.writeUIntLE(height - 1, 27, 3);
  return bytes;
};

describe("runtime image validation boundary", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "runtime-image-validation-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("recognizes supported JPEG, PNG, and WebP headers without MediaInfo", async () => {
    const fixtures = [
      ["png", pngBytes(640, 480), { width: 640, height: 480 }],
      ["jpeg", jpegBytes(1280, 720), { width: 1280, height: 720 }],
      ["webp", webpBytes(320, 240), { width: 320, height: 240 }],
    ] as const;

    for (const [format, bytes, dimensions] of fixtures) {
      const filePath = join(directory, `image.${format}`);
      await writeFile(filePath, bytes);

      expect(detectImageFormat(bytes)).toBe(format);
      expect(parseImageDimensions(bytes)).toEqual(dimensions);
      await expect(validateImage(filePath, 1)).resolves.toEqual({
        valid: true,
        ...dimensions,
        format,
      });
    }
  });

  it("rejects unsupported formats and files below the configured size", async () => {
    const unsupportedPath = join(directory, "image.gif");
    const tinyPath = join(directory, "tiny.png");
    await writeFile(unsupportedPath, Buffer.from("GIF89a unsupported image payload", "ascii"));
    await writeFile(tinyPath, pngBytes(1, 1));

    await expect(validateImage(unsupportedPath, 1)).resolves.toEqual({
      valid: false,
      width: 0,
      height: 0,
      format: undefined,
      reason: "parse_failed",
    });
    await expect(validateImage(tinyPath)).resolves.toEqual({
      valid: false,
      width: 0,
      height: 0,
      reason: "file_too_small",
    });
  });
});
