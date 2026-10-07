import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfiguration } from "@mdcz/shared/config";
import { serializeConfiguration } from "@mdcz/shared/configCodec";
import { describe, expect, it } from "vitest";
import {
  mergeRuntimeConfig,
  parseRuntimeConfiguration,
  RuntimeConfigProfileStore,
  RuntimeConfigService,
  RuntimeConfigValidationError,
} from "./index";

describe("RuntimeConfigProfileStore", () => {
  it("creates a default TOML profile and reloads persisted configuration", async () => {
    const configDir = await createTempDir();
    const store = new RuntimeConfigProfileStore({ configDir });

    const configuration = await store.load();
    const persisted = await readFile(join(configDir, "default.toml"), "utf8");

    expect(configuration).toEqual(defaultConfiguration);
    expect(persisted).toContain("[network]");

    await store.save({
      ...defaultConfiguration,
      network: { ...defaultConfiguration.network, timeout: 22 },
      download: { ...defaultConfiguration.download, nfoIgnoreFields: ["plot", "director"] },
    });

    const reloaded = await new RuntimeConfigProfileStore({ configDir }).load();
    expect(reloaded.network.timeout).toBe(22);
    expect(reloaded.download.nfoIgnoreFields).toEqual(["plot", "director"]);
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
  it("merges patches, reports field errors, and converts single-directory settings into a library once", async () => {
    const merged = mergeRuntimeConfig(defaultConfiguration, { network: { timeout: 33 } });

    expect(parseRuntimeConfiguration(merged).network.timeout).toBe(33);
    expect(() => parseRuntimeConfiguration({ paths: { actorPhotoFolder: "actors" } })).toThrow(
      RuntimeConfigValidationError,
    );
    expect(() => parseRuntimeConfiguration({ download: { nfoNaming: "invalid" } })).toThrow(
      RuntimeConfigValidationError,
    );

    const configDir = await createTempDir();
    const mediaPath = join(configDir, "media");
    await writeFile(
      join(configDir, "default.toml"),
      [
        "[paths]",
        `mediaPath = ${JSON.stringify(mediaPath)}`,
        'successOutputFolder = "out"',
        'actorPhotoFolder = "actors"',
        "[behavior]",
        "successFileRename = false",
        "[naming]",
        'folderTemplate = "{number}"',
        "[watch]",
        "enabled = true",
        "intervalMinutes = 30",
      ].join("\n"),
      "utf8",
    );
    const service = new RuntimeConfigService({ store: new RuntimeConfigProfileStore({ configDir }) });
    const loaded = await service.load();

    expect(loaded.paths.actorPhotoFolder).toBe(join(mediaPath, "actors"));
    expect(loaded).not.toHaveProperty("watch");
    expect(service.takeLegacyConversion()).toEqual({
      library: {
        name: "media",
        sourcePath: mediaPath,
        outputPath: join(mediaPath, "out"),
        folderTemplate: "{number}",
        fileTemplate: "{filename}",
        placement: "move",
        automation: "scrape",
        discovery: "events",
        cloudPath: "",
        scanIntervalMinutes: 30,
      },
    });
    expect(service.takeLegacyConversion()).toBeUndefined();
  });
});

describe("RuntimeConfigService profile watcher", () => {
  it("validates an active profile import before replacing its file", async () => {
    const configDir = await createTempDir();
    const profilePath = join(configDir, "default.toml");
    const sourcePath = join(configDir, "incoming.toml");
    let afterCommit = 0;
    const service = new RuntimeConfigService({
      store: new RuntimeConfigProfileStore({ configDir }),
      onBeforeCommit: (configuration) => {
        if (configuration.paths.actorPhotoFolder) throw new Error("actor folder unavailable");
      },
      onAfterCommit: (_configuration, { source }) => {
        if (source === "save") afterCommit += 1;
      },
    });
    await service.load();
    const original = await readFile(profilePath, "utf8");
    await writeFile(
      sourcePath,
      serializeConfiguration({
        ...defaultConfiguration,
        paths: { ...defaultConfiguration.paths, actorPhotoFolder: "/offline/actors" },
      }),
      "utf8",
    );

    await expect(service.importProfileFromFile({ sourcePath, name: "default", overwrite: true })).rejects.toThrow(
      "actor folder unavailable",
    );
    await expect(readFile(profilePath, "utf8")).resolves.toBe(original);
    await expect(service.get()).resolves.toMatchObject({ paths: { actorPhotoFolder: "" } });
    expect(afterCommit).toBe(0);
  });

  it("does not register after commit when save finalization fails", async () => {
    const configDir = await createTempDir();
    let afterCommit = 0;
    const service = new RuntimeConfigService({
      store: new RuntimeConfigProfileStore({ configDir }),
      onAfterSave: () => {
        throw new Error("persist failed");
      },
      onAfterCommit: (_configuration, { source }) => {
        if (source === "save") afterCommit += 1;
      },
    });
    await service.load();

    await expect(service.update({ network: { timeout: 12 } })).rejects.toThrow("persist failed");
    expect(afterCommit).toBe(0);
  });

  it("rejects a switched profile before applying loaded configuration", async () => {
    const configDir = await createTempDir();
    const appliedActorFolders: string[] = [];
    const store = new RuntimeConfigProfileStore({ configDir });
    const service = new RuntimeConfigService({
      store,
      onAfterLoad: (configuration) => {
        appliedActorFolders.push(configuration.paths.actorPhotoFolder);
        return configuration;
      },
      onBeforeCommit: (configuration, { source }) => {
        if (source === "switch" && configuration.paths.actorPhotoFolder) throw new Error("actor folder unavailable");
      },
    });
    await service.load();
    await store.createProfile("offline");
    await writeFile(
      join(configDir, "offline.toml"),
      serializeConfiguration({
        ...defaultConfiguration,
        paths: { ...defaultConfiguration.paths, actorPhotoFolder: "/offline/actors" },
      }),
      "utf8",
    );

    await expect(service.switchProfile("offline")).rejects.toThrow("actor folder unavailable");
    expect(appliedActorFolders).toEqual([""]);
    await expect(service.get()).resolves.toMatchObject({ paths: { actorPhotoFolder: "" } });
    expect((await store.listProfiles()).active).toBe("default");
  });
});

const createTempDir = async (): Promise<string> => await mkdtemp(join(tmpdir(), "mdcz-runtime-config-"));
