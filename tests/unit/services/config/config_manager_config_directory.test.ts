import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockUserDataPath = "";

vi.mock("electron", () => {
  return {
    app: {
      isReady: () => false,
      isPackaged: false,
      getAppPath: () => "/tmp/app",
      getPath: (name: string) => {
        if (name === "userData") {
          return mockUserDataPath;
        }
        throw new Error(`Unsupported app path: ${name}`);
      },
      commandLine: {
        appendSwitch: () => {},
      },
      setAppUserModelId: () => {},
    },
  };
});

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
};

describe("ConfigManager configDirectory", () => {
  beforeEach(async () => {
    mockUserDataPath = await mkdtemp(join(tmpdir(), "config-manager-"));
    await mkdir(mockUserDataPath, { recursive: true });
    vi.resetModules();
  });

  it("applies paths.configDirectory immediately and keeps it after reload", async () => {
    const { ConfigManager } = await import("@main/services/config/ConfigManager");

    const manager = new ConfigManager();
    await manager.save({
      paths: {
        configDirectory: "custom-config",
      },
    });

    const expectedConfigPath = join(mockUserDataPath, "custom-config", "default.json");
    const expectedMetaPath = join(mockUserDataPath, ".config-directory.json");

    expect(await fileExists(expectedConfigPath)).toBe(true);
    expect(await fileExists(expectedMetaPath)).toBe(true);

    const reloaded = new ConfigManager();
    const configuration = await reloaded.getValidated();
    expect(configuration.paths.configDirectory).toBe("custom-config");
    expect(reloaded.list().dataDir).toBe(join(mockUserDataPath, "custom-config"));
  });

  it("creates, switches, and deletes profiles in the active config directory", async () => {
    const { ConfigManager } = await import("@main/services/config/ConfigManager");

    const manager = new ConfigManager();
    await manager.createProfile("windows-dev");

    expect(await fileExists(join(mockUserDataPath, "config", "windows-dev.json"))).toBe(true);

    const createdProfiles = await manager.listProfiles();
    expect(createdProfiles.profiles).toEqual(expect.arrayContaining(["default", "windows-dev"]));
    expect(createdProfiles.active).toBe("default");

    await manager.switchProfile("windows-dev");

    const switchedProfiles = await manager.listProfiles();
    expect(switchedProfiles.active).toBe("windows-dev");
    expect(manager.list().configPath).toBe(join(mockUserDataPath, "config", "windows-dev.json"));

    await expect(manager.deleteProfile("windows-dev")).rejects.toThrow("Cannot delete the active profile");

    await manager.switchProfile("default");
    await manager.deleteProfile("windows-dev");

    const deletedProfiles = await manager.listProfiles();
    expect(deletedProfiles.profiles).toEqual(["default"]);
    expect(await fileExists(join(mockUserDataPath, "config", "windows-dev.json"))).toBe(false);
  });

  it("exports the active profile as formatted JSON", async () => {
    const { ConfigManager } = await import("@main/services/config/ConfigManager");

    const manager = new ConfigManager();
    await manager.save({
      naming: {
        fileTemplate: "{number}-{title}",
      },
      ui: {
        hideMenu: true,
      },
    });

    const exportDir = join(mockUserDataPath, "exports");
    const exportPath = join(exportDir, "quiet-settings.json");
    await mkdir(exportDir, { recursive: true });

    await manager.exportProfile("default", exportPath);

    const exported = JSON.parse(await readFile(exportPath, "utf8"));
    expect(exported.naming.fileTemplate).toBe("{number}-{title}");
    expect(exported.ui.hideMenu).toBe(true);
  });

  it("resets dynamic site custom URLs to the site-config schema default", async () => {
    const { ConfigManager } = await import("@main/services/config/ConfigManager");

    const manager = new ConfigManager();
    await manager.save({
      scrape: {
        siteConfigs: {
          javdb: { customUrl: "https://mirror.example" },
        },
      },
    });

    await manager.reset("scrape.siteConfigs.javdb.customUrl");

    const configuration = await manager.getValidated();
    const persisted = JSON.parse(await readFile(join(mockUserDataPath, "config", "default.json"), "utf8"));
    expect(configuration.scrape.siteConfigs.javdb.customUrl).toBe("");
    expect(persisted.scrape.siteConfigs.javdb.customUrl).toBe("");
  });

  it("imports a profile file and refreshes the active profile when overwriting it", async () => {
    const { ConfigManager } = await import("@main/services/config/ConfigManager");

    const manager = new ConfigManager();
    const current = await manager.getValidated();
    const importPath = join(mockUserDataPath, "incoming-profile.json");

    await writeFile(
      importPath,
      `${JSON.stringify(
        {
          ...current,
          naming: {
            ...current.naming,
            fileTemplate: "{number}-imported",
          },
          ui: {
            ...current.ui,
            hideMenu: true,
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await manager.importProfile(importPath, "default", true);
    const reloaded = await manager.getValidated();

    expect(result).toEqual({
      profileName: "default",
      overwritten: true,
      active: true,
    });
    expect(reloaded.naming.fileTemplate).toBe("{number}-imported");
    expect(reloaded.ui.hideMenu).toBe(true);
  });

  it("does not overwrite an unreadable active config file", async () => {
    const configDir = join(mockUserDataPath, "config");
    const configPath = join(configDir, "default.json");
    await mkdir(configDir, { recursive: true });

    const futureConfig = {
      configVersion: 99,
      paths: {
        configDirectory: "config",
      },
    };
    await writeFile(configPath, JSON.stringify(futureConfig, null, 2), "utf8");

    const { ConfigManager } = await import("@main/services/config/ConfigManager");

    const manager = new ConfigManager();
    const configuration = await manager.getValidated();
    const persisted = JSON.parse(await readFile(configPath, "utf8"));

    expect(configuration.paths.configDirectory).toBe("config");
    expect(persisted).toEqual(futureConfig);
  });

  it("preserves other profiles with unsupported future config versions during cleanup", async () => {
    const configDir = join(mockUserDataPath, "config");
    const futureProfilePath = join(configDir, "windows-dev.json");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      futureProfilePath,
      JSON.stringify(
        {
          configVersion: 99,
          paths: {
            configDirectory: "config",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const { ConfigManager } = await import("@main/services/config/ConfigManager");

    const manager = new ConfigManager();
    const profiles = await manager.listProfiles();

    expect(profiles.profiles).toContain("windows-dev");
    expect(await fileExists(futureProfilePath)).toBe(true);
  });

  it("retries ensureLoaded after an initial load failure", async () => {
    let failOnce = true;
    const expectedDataDir = join(mockUserDataPath, "config");

    vi.doMock("node:fs/promises", async () => {
      const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

      return {
        ...actual,
        mkdir: vi.fn(async (...args: Parameters<typeof actual.mkdir>) => {
          if (failOnce && args[0] === expectedDataDir) {
            failOnce = false;
            throw new Error("Injected config load failure");
          }

          return actual.mkdir(...args);
        }),
      };
    });

    const { ConfigManager } = await import("@main/services/config/ConfigManager");

    const manager = new ConfigManager();

    await expect(manager.ensureLoaded()).rejects.toThrow("Injected config load failure");
    await expect(manager.ensureLoaded()).resolves.toBeUndefined();
    await expect(manager.getValidated()).resolves.toMatchObject({
      paths: {
        configDirectory: "config",
      },
    });

    vi.doUnmock("node:fs/promises");
  });
});
