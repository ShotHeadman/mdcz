import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfiguration } from "@mdcz/shared/config";
import { serializeConfiguration } from "@mdcz/shared/configCodec";
import { describe, expect, it } from "vitest";
import {
  buildRuntimeNamingPreview,
  mergeRuntimeConfig,
  parseRuntimeConfiguration,
  RuntimeConfigProfileStore,
  RuntimeConfigValidationError,
} from "./index";

describe("RuntimeConfigProfileStore", () => {
  it("creates and loads a default TOML profile", async () => {
    const configDir = await createTempDir();
    const store = new RuntimeConfigProfileStore({ configDir });

    const configuration = await store.load();
    const persisted = await readFile(join(configDir, "default.toml"), "utf8");

    expect(configuration).toEqual(defaultConfiguration);
    expect(persisted).toContain("[network]");
  });

  it("manages profile lifecycle and preserves active profile injection", async () => {
    const configDir = await createTempDir();
    const store = new RuntimeConfigProfileStore({ configDir });

    await store.load();
    await store.createProfile("windows-dev");
    await store.switchProfile("windows-dev");

    expect(await store.listProfiles()).toEqual({
      profiles: ["default", "windows-dev"],
      active: "windows-dev",
    });

    const reloaded = new RuntimeConfigProfileStore({ configDir, activeProfileName: "windows-dev" });
    expect(reloaded.configPath).toBe(join(configDir, "windows-dev.toml"));
  });

  it("imports, exports, and validates profile content", async () => {
    const configDir = await createTempDir();
    const store = new RuntimeConfigProfileStore({ configDir });
    await store.load();

    const result = await store.importProfile({
      name: "imported",
      content: serializeConfiguration({
        ...defaultConfiguration,
        network: { ...defaultConfiguration.network, timeout: 22 },
      }),
    });

    expect(result).toEqual({ profileName: "imported", overwritten: false, active: false });
    expect((await store.exportProfile("imported")).content).toContain("timeout = 22");

    await store.importProfile({
      name: "json-imported",
      content: JSON.stringify({
        ...defaultConfiguration,
        network: { ...defaultConfiguration.network, timeout: 44 },
      }),
      fileName: "json-imported.json",
    });
    expect((await store.exportProfile("json-imported")).content).toContain("timeout = 44");

    await expect(
      store.importProfile({
        name: "bad",
        content: '[download]\nnfoNaming = "invalid"\n',
      }),
    ).rejects.toBeInstanceOf(RuntimeConfigValidationError);
  });

  it("cleans invalid inactive legacy profiles without touching the active profile", async () => {
    const configDir = await createTempDir();
    const store = new RuntimeConfigProfileStore({ configDir });
    await store.load();
    await writeFile(join(configDir, "broken.json"), JSON.stringify({ jellyfin: { userId: "not-a-uuid" } }), "utf8");

    await store.cleanupInvalidNonActiveProfiles();

    expect((await store.listProfiles()).profiles).toEqual(["default"]);
  });
});

describe("runtime config helpers", () => {
  it("merges patches, reports field errors, and builds naming previews", () => {
    const merged = mergeRuntimeConfig(defaultConfiguration, { network: { timeout: 33 } });

    expect(parseRuntimeConfiguration(merged).network.timeout).toBe(33);
    expect(() => parseRuntimeConfiguration({ download: { nfoNaming: "invalid" } })).toThrow(
      RuntimeConfigValidationError,
    );
    expect(
      buildRuntimeNamingPreview(defaultConfiguration, {
        naming: { folderTemplate: "{actor}/{number}", fileTemplate: "{number} {title}" },
      }).items[0],
    ).toMatchObject({
      label: "普通",
      folder: "演员A/ABC-123",
      file: "ABC-123 示例中文标题.mp4",
    });
  });
});

const createTempDir = async (): Promise<string> => await mkdtemp(join(tmpdir(), "mdcz-runtime-config-"));
