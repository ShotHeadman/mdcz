import { mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileMover } from "./FileMover";
import { SidecarResolver } from "./SidecarResolver";

const directories: string[] = [];

const createTempDir = async (name: string): Promise<string> => {
  const directory = join(tmpdir(), `mdcz-file-mover-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(directory, { recursive: true });
  directories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (directory) => await rm(directory, { recursive: true, force: true })),
  );
});

describe("FileMover empty-ancestor cleanup", () => {
  it("does not treat a prefix sibling as contained by the stop boundary", async () => {
    const parent = await createTempDir("prefix");
    const output = join(parent, "foo");
    const sourceRoot = join(parent, "foo-source");
    const incoming = join(sourceRoot, "incoming");
    await mkdir(output);
    await mkdir(incoming, { recursive: true });

    const mover = new FileMover({ info() {} }, new SidecarResolver());
    await mover.cleanupEmptyAncestors(incoming, output);

    await expect(readdir(sourceRoot)).resolves.toEqual(["incoming"]);
  });

  it("deletes emptied source folders without removing the source root", async () => {
    const sourceRoot = await createTempDir("source-root");
    const incoming = join(sourceRoot, "incoming");
    await mkdir(incoming, { recursive: true });

    const mover = new FileMover({ info() {} }, new SidecarResolver());
    await mover.cleanupEmptyAncestors(incoming, sourceRoot);

    await expect(readdir(sourceRoot)).resolves.toEqual([]);
  });
});
