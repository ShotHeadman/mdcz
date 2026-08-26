import { mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
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
      file: "ABC-123 示例中文标题.mp4",
    });
    expect(
      buildRuntimeNamingPreview(defaultConfiguration, {
        naming: { folderTemplate: "{actor}/{number}", fileTemplate: "{number} {title}" },
      }).items[0]?.folder,
    ).toContain("演员A");

    const expandedPreview = buildRuntimeNamingPreview(defaultConfiguration, {
      naming: {
        folderTemplate: "{firstLetter}-{number}",
        fileTemplate: "{rawNumber}-{4K}{cnword}-{title}",
        cnwordStyle: "-SUB",
      },
    }).items.find((item) => item.label === "中文字幕");

    expect(expandedPreview).toMatchObject({
      folder: "A-ABC-456-SUB",
      file: "ABC-456-4K-SUB-中文字幕示例.mp4",
    });
  });
});

describe("RuntimeConfigService profile watcher", () => {
  it("reloads valid edits and keeps the last-known-good value for invalid edits", async () => {
    const configDir = await createTempDir();
    const store = new RuntimeConfigProfileStore({ configDir });
    const service = new RuntimeConfigService({ store });
    await service.load();
    const changes: string[] = [];
    const diagnostics: string[] = [];
    service.onChange((event) => changes.push(event.source));
    service.onDiagnostic((event) => diagnostics.push(event.kind));
    await service.startWatching({ debounceMs: 25 });

    await writeFile(
      join(configDir, "default.toml"),
      serializeConfiguration({
        ...defaultConfiguration,
        network: { ...defaultConfiguration.network, timeout: 77 },
      }),
      "utf8",
    );
    await waitFor(() => changes.includes("watch"));
    expect((await service.get()).network.timeout).toBe(77);

    await writeFile(join(configDir, "default.toml"), '[network]\ntimeout = "invalid"\n', "utf8");
    await waitFor(() => diagnostics.includes("invalid"));
    expect((await service.get()).network.timeout).toBe(77);

    await store.createProfile("alternate");
    await service.switchProfile("alternate");
    await writeFile(
      join(configDir, "alternate.toml"),
      serializeConfiguration({
        ...defaultConfiguration,
        network: { ...defaultConfiguration.network, timeout: 88 },
      }),
      "utf8",
    );
    await waitFor(() => changes.filter((source) => source === "watch").length >= 2);
    expect((await service.get()).network.timeout).toBe(88);
    await service.stopWatching();
  });

  it("rebinds to a replacement store configuration directory", async () => {
    const originalConfigDir = await createTempDir();
    const replacementConfigDir = await createTempDir();
    const originalStore = new RuntimeConfigProfileStore({ configDir: originalConfigDir });
    const replacementStore = new RuntimeConfigProfileStore({ configDir: replacementConfigDir });
    await replacementStore.load();

    const service = new RuntimeConfigService({ store: originalStore });
    await service.load();
    const watchedTimeouts: number[] = [];
    service.onChange((event) => {
      if (event.source === "watch") watchedTimeouts.push(event.configuration.network.timeout);
    });
    await service.startWatching({ debounceMs: 25 });

    service.replaceStore(replacementStore);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await writeFile(
      join(replacementConfigDir, "default.toml"),
      serializeConfiguration({
        ...defaultConfiguration,
        network: { ...defaultConfiguration.network, timeout: 91 },
      }),
      "utf8",
    );
    await waitFor(() => watchedTimeouts.includes(91));

    await writeFile(
      join(originalConfigDir, "default.toml"),
      serializeConfiguration({
        ...defaultConfiguration,
        network: { ...defaultConfiguration.network, timeout: 92 },
      }),
      "utf8",
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(watchedTimeouts).toEqual([91]);
    expect((await service.get()).network.timeout).toBe(91);
    await service.stopWatching();
  });

  it("coalesces burst writes and reloads an atomically replaced profile", async () => {
    const configDir = await createTempDir();
    const profilePath = join(configDir, "default.toml");
    const service = new RuntimeConfigService({ store: new RuntimeConfigProfileStore({ configDir }) });
    await service.load();
    const watchedTimeouts: number[] = [];
    service.onChange((event) => {
      if (event.source === "watch") watchedTimeouts.push(event.configuration.network.timeout);
    });
    await service.startWatching({ debounceMs: 40 });

    const replacementPath = join(configDir, "default.toml.next");
    await writeFile(replacementPath, configurationWithTimeout(71), "utf8");
    await rename(replacementPath, profilePath);
    await waitFor(() => watchedTimeouts.includes(71));

    await writeFile(profilePath, configurationWithTimeout(72), "utf8");
    await writeFile(profilePath, configurationWithTimeout(73), "utf8");
    await writeFile(profilePath, configurationWithTimeout(74), "utf8");
    await waitFor(() => watchedTimeouts.includes(74));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(watchedTimeouts).toEqual([71, 74]);
    expect((await service.get()).network.timeout).toBe(74);
    await service.stopWatching();
  });
});

const configurationWithTimeout = (timeout: number): string =>
  serializeConfiguration({
    ...defaultConfiguration,
    network: { ...defaultConfiguration.network, timeout },
  });

const waitFor = async (predicate: () => boolean): Promise<void> => {
  const deadline = Date.now() + 2_000;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(predicate()).toBe(true);
};

const createTempDir = async (): Promise<string> => await mkdtemp(join(tmpdir(), "mdcz-runtime-config-"));
