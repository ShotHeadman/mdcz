import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
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
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const home = options.homeDir ?? homedir();
  const baseDir = resolveServerBaseDir(env, platform, home);
  const configDir = pathApi.resolve(env.MDCZ_CONFIG_DIR ?? pathApi.join(baseDir, "config"));
  const dataDir = pathApi.resolve(env.MDCZ_DATA_DIR ?? pathApi.join(baseDir, "data"));

  return {
    configDir,
    dataDir,
    configPath: pathApi.join(configDir, `default${CONFIGURATION_FILE_EXTENSIONS.toml}`),
    databasePath: pathApi.resolve(env.MDCZ_DATABASE_PATH ?? pathApi.join(dataDir, "mdcz.sqlite")),
  };
};

export class ServerConfigService {
  private configuration: Configuration | null = null;

  constructor(private readonly paths: ServerRuntimePaths = resolveServerRuntimePaths()) {}

  get runtimePaths(): ServerRuntimePaths {
    return this.paths;
  }

  async load(): Promise<Configuration> {
    if (!existsSync(this.paths.configPath)) {
      this.configuration = defaultConfiguration;
      await this.persist();
      return this.configuration;
    }

    const content = await readFile(this.paths.configPath, "utf8");
    this.configuration = parseConfigurationContent(content, "toml");

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

  async export(): Promise<string> {
    return serializeConfiguration(await this.get(), "toml");
  }

  private async persist(): Promise<void> {
    await mkdir(this.paths.configDir, { recursive: true });
    await mkdir(this.paths.dataDir, { recursive: true });
    await writeFile(this.paths.configPath, serializeConfiguration(this.configuration ?? defaultConfiguration), "utf8");
  }
}

const resolveServerBaseDir = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string => {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  if (env.MDCZ_HOME) {
    return pathApi.resolve(env.MDCZ_HOME);
  }

  if (platform === "linux") {
    return pathApi.resolve(env.XDG_STATE_HOME ?? pathApi.join(home, ".local", "state"), "mdcz");
  }

  return pathApi.resolve(home, ".mdcz");
};
