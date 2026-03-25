import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockAppPath = "";
let mockUserDataPath = "";

vi.mock("electron", () => {
  return {
    app: {
      isPackaged: true,
      getAppPath: () => mockAppPath,
      getPath: (name: string) => {
        if (name === "userData") {
          return mockUserDataPath;
        }

        throw new Error(`Unsupported app path: ${name}`);
      },
    },
  };
});

const writeMappingFile = async (filePath: string, entries: unknown[]): Promise<void> => {
  await writeFile(
    filePath,
    `${JSON.stringify({
      version: 1,
      source: "test",
      entries,
    })}\n`,
    "utf8",
  );
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await readFile(filePath, "utf8");
    return true;
  } catch {
    return false;
  }
};

describe("translate mapping auto promotion", () => {
  let workspaceDir = "";
  let bundledDir = "";
  let userDataDir = "";

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), "translate-mapping-"));
    bundledDir = join(workspaceDir, "resources", "mapping_table");
    userDataDir = join(workspaceDir, "userData");

    await mkdir(bundledDir, { recursive: true });
    await mkdir(userDataDir, { recursive: true });

    mockAppPath = workspaceDir;
    mockUserDataPath = userDataDir;

    vi.resetModules();
  });

  it("auto promotes candidate after threshold when no conflict", async () => {
    await writeMappingFile(join(bundledDir, "mapping_actor.json"), []);
    await writeMappingFile(join(bundledDir, "mapping_info.json"), []);

    const translate = await import("@main/utils/translate");

    for (let index = 0; index < 3; index += 1) {
      await translate.appendMappingCandidate({
        category: "actor",
        keyword: "小花のん",
        mapped: "小花暖",
        target: "zh_cn",
      });
    }

    const mapped = await translate.findMappedActorName("小花のん", "zh_cn");
    expect(mapped).toBe("小花暖");

    const userMainPath = join(userDataDir, "mapping_table", "mapping_actor.user.json");
    const promoted = JSON.parse(await readFile(userMainPath, "utf8")) as {
      entries?: Array<{ aliases?: string[]; canonical?: string }>;
    };

    expect(promoted.entries?.[0]?.aliases).toContain("小花のん");
    expect(promoted.entries?.[0]?.canonical).toBe("小花暖");

    const candidatePath = join(userDataDir, "mapping_table", "mapping_actor.candidates.jsonl");
    const lines = (await readFile(candidatePath, "utf8"))
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    expect(lines).toHaveLength(3);
  });

  it("keeps conflict in candidates and skips promotion", async () => {
    await writeMappingFile(join(bundledDir, "mapping_actor.json"), [
      {
        canonical: "小花暖",
        aliases: ["小花のん"],
      },
    ]);
    await writeMappingFile(join(bundledDir, "mapping_info.json"), []);

    const translate = await import("@main/utils/translate");

    for (let index = 0; index < 3; index += 1) {
      await translate.appendMappingCandidate({
        category: "actor",
        keyword: "小花のん",
        mapped: "冲突译名",
        target: "zh_cn",
      });
    }

    const mapped = await translate.findMappedActorName("小花のん", "zh_cn");
    expect(mapped).toBe("小花暖");

    const userMainPath = join(userDataDir, "mapping_table", "mapping_actor.user.json");
    expect(await fileExists(userMainPath)).toBe(false);

    const candidatePath = join(userDataDir, "mapping_table", "mapping_actor.candidates.jsonl");
    const lines = (await readFile(candidatePath, "utf8"))
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    expect(lines).toHaveLength(3);
  });
});
