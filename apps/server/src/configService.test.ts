import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfiguration } from "@mdcz/shared/config";
import { serializeConfiguration } from "@mdcz/shared/configCodec";
import { describe, expect, it } from "vitest";
import { resolveServerRuntimePaths, ServerConfigService, type ServerConfigValidationError } from "./configService";

describe("resolveServerRuntimePaths", () => {
  it("uses XDG-style defaults on Linux", () => {
    const paths = resolveServerRuntimePaths({ env: {}, platform: "linux", homeDir: "/home/tester" });

    expect(paths.configDir).toBe("/home/tester/.local/state/mdcz/config");
    expect(paths.dataDir).toBe("/home/tester/.local/state/mdcz/data");
    expect(paths.configPath).toBe("/home/tester/.local/state/mdcz/config/default.toml");
    expect(paths.databasePath).toBe("/home/tester/.local/state/mdcz/data/mdcz.sqlite");
  });

  it("supports explicit env overrides", () => {
    const paths = resolveServerRuntimePaths({
      env: {
        MDCZ_CONFIG_DIR: "/srv/mdcz/config",
        MDCZ_DATA_DIR: "/srv/mdcz/data",
        MDCZ_DATABASE_PATH: "/srv/mdcz/database.sqlite",
      },
      platform: "linux",
      homeDir: "/home/tester",
    });

    expect(paths.configDir).toBe("/srv/mdcz/config");
    expect(paths.dataDir).toBe("/srv/mdcz/data");
    expect(paths.databasePath).toBe("/srv/mdcz/database.sqlite");
  });
});

describe("ServerConfigService", () => {
  it("creates a default TOML config when none exists", async () => {
    const root = await createTempDir();
    const service = new ServerConfigService(resolveServerRuntimePaths({ env: { MDCZ_HOME: root } }));

    const configuration = await service.load();
    const persisted = await readFile(service.runtimePaths.configPath, "utf8");

    expect(configuration).toEqual(defaultConfiguration);
    expect(persisted).toContain("[network]");
  });

  it("loads existing TOML config", async () => {
    const root = await createTempDir();
    const paths = resolveServerRuntimePaths({ env: { MDCZ_HOME: root } });
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(
      paths.configPath,
      serializeConfiguration(
        { ...defaultConfiguration, network: { ...defaultConfiguration.network, timeout: 22 } },
        "toml",
      ),
    );

    const service = new ServerConfigService(paths);

    expect((await service.load()).network.timeout).toBe(22);
  });

  it("reads and resets individual config paths like desktop config handlers", async () => {
    const root = await createTempDir();
    const service = new ServerConfigService(resolveServerRuntimePaths({ env: { MDCZ_HOME: root } }));

    await service.update({ network: { timeout: 22 } });

    expect(await service.get("network.timeout")).toBe(22);
    expect(await service.reset("network.timeout")).toMatchObject({
      network: { timeout: defaultConfiguration.network.timeout },
    });
  });

  it("builds naming previews from the active config plus a patch", async () => {
    const root = await createTempDir();
    const service = new ServerConfigService(resolveServerRuntimePaths({ env: { MDCZ_HOME: root } }));

    const preview = await service.previewNaming({
      naming: { folderTemplate: "{actor}/{number}", fileTemplate: "{number} {title}" },
    });

    expect(preview.items[0]).toMatchObject({
      label: "普通",
      folder: "演员A/ABC-123",
      file: "ABC-123 示例中文标题.mp4",
    });
  });

  it("reports desktop-style validation errors with fields", async () => {
    const root = await createTempDir();
    const service = new ServerConfigService(resolveServerRuntimePaths({ env: { MDCZ_HOME: root } }));

    await expect(service.update({ download: { nfoNaming: "invalid" as never } })).rejects.toMatchObject({
      fields: ["download.nfoNaming"],
    } satisfies Partial<ServerConfigValidationError>);
  });
});

const createTempDir = async (): Promise<string> => await mkdtemp(join(tmpdir(), "mdcz-server-config-"));
