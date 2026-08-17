import { mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileTranslationMappingStore } from "./FileTranslationMappingStore";

const writeMappingFile = async (filePath: string, entries: unknown[]): Promise<void> => {
  await writeFile(filePath, `${JSON.stringify({ version: 1, source: "test", entries })}\n`, "utf8");
};

describe("FileTranslationMappingStore", () => {
  let root = "";
  let bundledDirectory = "";
  let writableDirectory = "";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "runtime-translation-mapping-"));
    bundledDirectory = join(root, "bundled");
    writableDirectory = join(root, "writable");
    await mkdir(bundledDirectory, { recursive: true });
    await mkdir(writableDirectory, { recursive: true });
  });

  it("merges bundled mappings with writable mappings taking precedence", async () => {
    await writeMappingFile(join(bundledDirectory, "mapping_actor.json"), [
      { canonical: "Bundled Name", aliases: ["Alias"] },
    ]);
    await writeMappingFile(join(writableDirectory, "mapping_actor.user.json"), [
      { canonical: "User Name", aliases: ["Alias"] },
    ]);
    await writeMappingFile(join(bundledDirectory, "mapping_info.json"), [
      { keywords: ["Drama"], zh_cn: "剧情", zh_tw: "劇情" },
    ]);

    const store = new FileTranslationMappingStore({ bundledDirectory, writableDirectory });

    await expect(store.findMappedActorName("alias", "jp")).resolves.toBe("User Name");
    await expect(store.findMappedGenreName("drama", "zh_tw")).resolves.toBe("劇情");
  });

  it("treats missing mapping files as empty stores", async () => {
    const store = new FileTranslationMappingStore({ bundledDirectory, writableDirectory });

    await expect(store.findMappedActorName("unknown")).resolves.toBeNull();
    await expect(store.findMappedGenreName("unknown")).resolves.toBeNull();
  });

  it("rejects malformed mapping files with a content-safe log", async () => {
    await writeFile(join(bundledDirectory, "mapping_actor.json"), "secret invalid json", "utf8");
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const store = new FileTranslationMappingStore({ bundledDirectory, writableDirectory, logger });

    await expect(store.findMappedActorName("Alias")).rejects.toThrow("Failed to load actor translation mappings");
    expect(logger.error).toHaveBeenCalledWith("Failed to load actor translation mappings");
    expect(logger.error).not.toHaveBeenCalledWith(expect.stringContaining("secret"));
  });

  it("serializes candidates and promotes the third matching observation", async () => {
    const store = new FileTranslationMappingStore({ bundledDirectory, writableDirectory });

    await Promise.all(
      Array.from({ length: 3 }, () =>
        store.appendMappingCandidate({
          category: "actor",
          keyword: "小花のん",
          mapped: "小花暖",
          target: "zh_cn",
        }),
      ),
    );

    await expect(store.findMappedActorName("小花のん")).resolves.toBe("小花暖");
    const candidateLines = (await readFile(join(writableDirectory, "mapping_actor.candidates.jsonl"), "utf8"))
      .trim()
      .split("\n");
    expect(candidateLines).toHaveLength(3);

    const userDocument = JSON.parse(await readFile(join(writableDirectory, "mapping_actor.user.json"), "utf8")) as {
      entries: Array<{ canonical: string; aliases: string[] }>;
    };
    expect(userDocument.entries).toEqual([{ canonical: "小花暖", aliases: ["小花のん"] }]);
  });

  it("recovers the write queue after one failed candidate operation", async () => {
    const blockedPath = join(root, "not-a-directory");
    await writeFile(blockedPath, "blocked", "utf8");
    const store = new FileTranslationMappingStore({ bundledDirectory, writableDirectory: blockedPath });

    await expect(
      store.appendMappingCandidate({ category: "genre", keyword: "Drama", mapped: "剧情", target: "zh_cn" }),
    ).rejects.toThrow("Failed to persist genre translation mapping candidate");

    await unlink(blockedPath);
    await mkdir(blockedPath);
    await store.appendMappingCandidate({
      category: "genre",
      keyword: "Drama",
      mapped: "剧情",
      target: "zh_cn",
    });
    await expect(readFile(join(blockedPath, "mapping_info.candidates.jsonl"), "utf8")).resolves.toContain(
      '"keyword":"Drama"',
    );
  });
});
