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
const target = (itemId: string, sourcePath: string, targetVideoPath: string, artifactPaths?: readonly string[]) => ({
  itemId,
  sourcePath,
  targetVideoPath,
  artifactPaths,
});
const group = (...members: ReturnType<typeof target>[]) => ({ members });

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
      checkScrapeTargets([group(target("one", join(root, "source.mp4"), join(root, "ABC-123.mp4")))], inventory),
    ).rejects.toBeInstanceOf(ScrapeTargetConflictError);
    await expect(
      checkScrapeTargets(
        [
          group(target("one", join(root, "one.mp4"), join(root, "output", "DEF-456.mp4"))),
          group(target("two", join(root, "two.mp4"), join(root, "output", "DEF-456.mkv"))),
        ],
        inventory,
      ),
    ).rejects.toMatchObject({
      conflicts: [expect.objectContaining({ itemId: "one" }), expect.objectContaining({ itemId: "two" })],
    });
    await expect(
      checkScrapeTargets(
        [
          group(
            target("one", join(root, "IPX-123.mp4"), join(root, "output", "IPX-123.mp4")),
            target("two", join(root, "IPX-123-影片日文名称.mp4"), join(root, "output", "IPX-123.mp4")),
          ),
        ],
        inventory,
      ),
    ).rejects.toMatchObject({
      conflicts: [
        expect.objectContaining({
          itemId: "one",
          message: "同一影片的多个视频目标文件名重复，请调整命名规则以区分这些视频",
        }),
        expect.objectContaining({
          itemId: "two",
          message: "同一影片的多个视频目标文件名重复，请调整命名规则以区分这些视频",
        }),
      ],
    });
    await expect(
      checkScrapeTargets(
        [
          group(target("one", join(root, "left.mp4"), join(root, "left.mp4"), [join(root, "poster.jpg")])),
          group(target("two", join(root, "right.mp4"), join(root, "right.mp4"), [join(root, "poster.jpg")])),
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
    const stats = vi.spyOn(fs, "stat");
    const refs = [{ rootId: "source", relativePath: "ABC-123-CD1.mp4" }];
    const resolveRoot = async (id: string) => ({ id, hostPath: alias });
    await Promise.all([
      inventory.admitRefs(refs, resolveRoot),
      inventory.admitRefs(refs, resolveRoot),
      inventory.stats(join(source, "ABC-123-CD1.mp4")),
    ]);
    expect(stats).toHaveBeenCalledTimes(1);
    await inventory.admitRefs(refs, resolveRoot);
    expect(stats).toHaveBeenCalledTimes(1);
    await fs.link(join(source, "ABC-123-CD1.mp4"), join(source, "hardlink.mp4"));
    const distinct = [...refs, { rootId: "source", relativePath: "hardlink.mp4" }];
    if (process.platform !== "win32") {
      await fs.symlink(join(source, "ABC-123-CD1.mp4"), join(source, "symlink.mp4"));
      distinct.push({ rootId: "source", relativePath: "symlink.mp4" });
    }
    await expect(inventory.admitRefs(distinct, resolveRoot)).resolves.toEqual(distinct);
    await fs.writeFile(join(source, "ABC-123-CD1.nfo"), "<movie><num>ABC-123</num><title>Title</title></movie>");
    const reads = vi.spyOn(fs, "readFile");
    expect(reads).not.toHaveBeenCalled();
    await Promise.all([
      inventory.loadNfo(join(source, "ABC-123-CD1.nfo")),
      inventory.loadNfo(join(alias, "ABC-123-CD1.nfo")),
      inventory.readNfo(join(alias, "ABC-123-CD1.nfo")),
    ]);
    expect(reads).toHaveBeenCalledTimes(1);
    await expect(
      checkScrapeTargets(
        [
          group(
            target("one", join(alias, "ABC-123-CD1.mp4"), join(source, "ABC-123-CD1.mp4")),
            target("two", join(source, "ABC-123-CD2.mp4"), join(source, "ABC-123-CD2.mp4")),
          ),
          group(target("three", join(source, "other.mp4"), join(root, "other", "ABC-123-CD1.mkv"))),
        ],
        inventory,
      ),
    ).resolves.toBeUndefined();
    expect(listing.mock.calls.filter(([path]) => path === source)).toHaveLength(0);
  });
});
