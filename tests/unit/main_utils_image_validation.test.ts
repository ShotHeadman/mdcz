import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const runWithMediaInfoMock = vi.hoisted(() => vi.fn());

vi.mock("@main/utils/video", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@main/utils/video")>();
  return {
    ...actual,
    runWithMediaInfo: runWithMediaInfoMock,
  };
});

import { validateImage } from "@main/utils/image";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-image-validation-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const JPEG_1920_1080_BYTES = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x38, 0x07, 0x80, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11,
  0x01, 0xff, 0xd9,
]);

describe("main image validation", () => {
  afterEach(async () => {
    runWithMediaInfoMock.mockReset();
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map(async (dirPath) => {
        await rm(dirPath, { recursive: true, force: true });
      }),
    );
  });

  it("accepts jpeg files from header dimensions without requiring mediainfo", async () => {
    runWithMediaInfoMock.mockRejectedValue(new Error("mediainfo should not be needed"));

    const root = await createTempDir();
    const filePath = join(root, "poster.jpg");
    await writeFile(filePath, JPEG_1920_1080_BYTES);

    await expect(validateImage(filePath, 1)).resolves.toEqual({
      valid: true,
      width: 1920,
      height: 1080,
      format: "jpeg",
    });
    expect(runWithMediaInfoMock).not.toHaveBeenCalled();
  });
});
