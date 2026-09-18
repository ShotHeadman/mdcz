import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectoryInventory } from "./DirectoryInventory";
import { checkScrapeTargets, ScrapeTargetConflictError } from "./preflightScrapeTask";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "mdcz-targets-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
const target = (itemId: string, sourcePath: string, targetVideoPath: string) => ({
  itemId,
  sourcePath,
  outputPlan: { targetVideoPath },
});

describe("inventory target conflicts", () => {
  it("rejects existing and batch-duplicate extensionless movie names without inspecting unrelated entries", async () => {
    await fs.writeFile(join(root, "ABC-123.mkv"), "existing");
    const missing = join(root, "missing");
    await fs.mkdir(missing);
    await fs.symlink(missing, join(root, "unrelated.link"), process.platform === "win32" ? "junction" : "dir");
    await fs.rm(missing, { recursive: true });
    const inventory = new DirectoryInventory();
    const stats = vi.spyOn(fs, "stat");
    await expect(
      checkScrapeTargets([target("one", join(root, "source.mp4"), join(root, "ABC-123.mp4"))], inventory),
    ).rejects.toBeInstanceOf(ScrapeTargetConflictError);
    await expect(
      checkScrapeTargets(
        [
          target("one", join(root, "one.mp4"), join(root, "output", "DEF-456.mp4")),
          target("two", join(root, "two.mp4"), join(root, "output", "DEF-456.mkv")),
        ],
        inventory,
      ),
    ).rejects.toMatchObject({
      conflicts: [expect.objectContaining({ itemId: "one" }), expect.objectContaining({ itemId: "two" })],
    });
    expect(stats).not.toHaveBeenCalled();
  });

  it("allows in-place alias rescrapes, multipart targets, separate directories, and generated sidecars", async () => {
    const source = join(root, "media");
    const alias = join(root, "alias");
    await fs.mkdir(source);
    await fs.symlink(source, alias, process.platform === "win32" ? "junction" : "dir");
    await fs.writeFile(join(source, "ABC-123-CD1.mp4"), "video");
    await fs.writeFile(join(source, "ABC-123-CD1-trailer.mp4"), "feature");
    const inventory = new DirectoryInventory();
    await inventory.entries(source);
    const listing = vi.spyOn(fs, "readdir");
    await expect(
      checkScrapeTargets(
        [
          target("one", join(alias, "ABC-123-CD1.mp4"), join(source, "ABC-123-CD1.mp4")),
          target("two", join(source, "ABC-123-CD2.mp4"), join(source, "ABC-123-CD2.mp4")),
          target("three", join(source, "other.mp4"), join(root, "other", "ABC-123-CD1.mkv")),
        ],
        inventory,
      ),
    ).resolves.toBeUndefined();
    expect(listing.mock.calls.filter(([path]) => path === source)).toHaveLength(0);
  });
});
