import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { type Configuration, defaultConfiguration } from "@mdcz/shared/config";
import {
  CONFIGURATION_FILE_EXTENSIONS,
  parseConfigurationContent,
  serializeConfiguration,
} from "@mdcz/shared/configCodec";

export interface ServerRuntimePaths {
  configDir: string;
  dataDir: string;
  configPath: string;
  legacyConfigPath: string;
  databasePath: string;
}

export interface ResolveServerRuntimePathsOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
}

export const resolveServerRuntimePaths = (options: ResolveServerRuntimePathsOptions = {}): ServerRuntimePaths => {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.homeDir ?? homedir();
  const baseDir = resolveServerBaseDir(env, platform, home);
  const configDir = resolve(env.MDCZ_CONFIG_DIR ?? join(baseDir, "config"));
  const dataDir = resolve(env.MDCZ_DATA_DIR ?? join(baseDir, "data"));

  return {
    configDir,
    dataDir,
    configPath: join(configDir, `default${CONFIGURATION_FILE_EXTENSIONS.toml}`),
    legacyConfigPath: join(configDir, `default${CONFIGURATION_FILE_EXTENSIONS.json}`),
    databasePath: resolve(env.MDCZ_DATABASE_PATH ?? join(dataDir, "mdcz.sqlite")),
  };
};

export class ServerConfigService {
  private configuration: Configuration | null = null;

  constructor(private readonly paths: ServerRuntimePaths = resolveServerRuntimePaths()) {}

  get runtimePaths(): ServerRuntimePaths {
    return this.paths;
  }

  async load(): Promise<Configuration> {
    const sourcePath = this.getReadableConfigPath();
    if (!sourcePath) {
      this.configuration = defaultConfiguration;
      await this.persist();
      return this.configuration;
    }

    const format = sourcePath === this.paths.legacyConfigPath ? "json" : "toml";
    const content = await readFile(sourcePath, "utf8");
    this.configuration = parseConfigurationContent(content, format);

    if (sourcePath === this.paths.legacyConfigPath) {
      await this.persist();
    }

    return this.configuration;
  }

  async get(): Promise<Configuration> {
    if (!this.configuration) {
      return await this.load();
    }

    return this.configuration;
  }

  async save(configuration: Configuration): Promise<Configuration> {
    this.configuration = configuration;
    await this.persist();
    return this.configuration;
  }

  async export(format: "toml" | "json" = "toml"): Promise<string> {
    return serializeConfiguration(await this.get(), format);
  }

  private getReadableConfigPath(): string | null {
    if (existsSync(this.paths.configPath)) {
      return this.paths.configPath;
    }

    if (existsSync(this.paths.legacyConfigPath)) {
      return this.paths.legacyConfigPath;
    }

    return null;
  }

  private async persist(): Promise<void> {
    await mkdir(this.paths.configDir, { recursive: true });
    await mkdir(this.paths.dataDir, { recursive: true });
    await writeFile(this.paths.configPath, serializeConfiguration(this.configuration ?? defaultConfiguration), "utf8");
  }
}

const resolveServerBaseDir = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string => {
  if (env.MDCZ_HOME) {
    return resolve(env.MDCZ_HOME);
  }

  if (platform === "linux") {
    return resolve(env.XDG_STATE_HOME ?? join(home, ".local", "state"), "mdcz");
  }

  return resolve(home, ".mdcz");
};
