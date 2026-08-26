import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ServerConfigService } from "./services/configService";
import { createServerTranslationMappingStore, resolveServerBundledMappingDirectory } from "./translationMappingStore";

describe("server translation mapping store", () => {
  it("resolves distributed mappings and writes candidates under the server data directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "server-translation-mapping-"));
    const config = new ServerConfigService({
      configDir: path.join(root, "config"),
      dataDir: path.join(root, "data"),
      configPath: path.join(root, "config", "default.toml"),
      databasePath: path.join(root, "data", "mdcz.sqlite"),
    });
    const store = createServerTranslationMappingStore(config);

    expect(resolveServerBundledMappingDirectory()).toContain("mapping_table");
    await expect(store.findMappedActorName("AV女優", "jp")).resolves.toBe("女優");
    await store.appendMappingCandidate({
      category: "genre",
      keyword: "Drama",
      mapped: "剧情",
      target: "zh_cn",
    });

    await expect(
      readFile(path.join(root, "data", "mapping_table", "mapping_info.candidates.jsonl"), "utf8"),
    ).resolves.toContain('"keyword":"Drama"');
  });
});
