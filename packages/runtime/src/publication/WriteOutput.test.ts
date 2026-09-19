import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WriteOutput } from "./WriteOutput";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("WriteOutput", () => {
  it("atomically replaces artifacts and supports idempotent reruns", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mdcz-write-output-"));
    directories.push(directory);
    const targetPath = path.join(directory, "movie.nfo");
    await writeFile(targetPath, "old");
    const output = new WriteOutput();
    await output.install([{ targetPath, data: "new" }], { commit: () => undefined });
    await output.install([{ targetPath, data: "new" }], { commit: () => undefined });
    await expect(readFile(targetPath, "utf8")).resolves.toBe("new");
  });

  it.each(["protected-root", "protected-media"])("rejects unsafe write targets: %s", async (scenario) => {
    const directory = await mkdtemp(path.join(tmpdir(), "mdcz-write-output-"));
    directories.push(directory);
    const targetPath = path.join(directory, "movie.nfo");
    await expect(
      new WriteOutput().install([{ targetPath, data: "new" }], {
        protectedSourceRoots: scenario === "protected-root" ? [directory] : undefined,
        protectedMediaFiles: scenario === "protected-media" ? [targetPath] : undefined,
        commit: () => undefined,
      }),
    ).rejects.toThrow(scenario === "protected-root" ? "protected source root" : "cannot overwrite a source media file");
  });
});
