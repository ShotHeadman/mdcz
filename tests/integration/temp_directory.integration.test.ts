import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTempDirectory } from "../harness/tempDirectory";

describe("temporary directory harness", () => {
  it("isolates files and removes the directory with idempotent cleanup", async () => {
    const directory = await createTempDirectory("harness integration");
    const fixturePath = join(directory.path, "fixture.txt");

    try {
      await writeFile(fixturePath, "fixture", "utf8");
      await expect(access(fixturePath)).resolves.toBeUndefined();
    } finally {
      await directory.cleanup();
      await directory.cleanup();
    }

    await expect(access(directory.path)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
