import { homedir } from "node:os";
import path from "node:path";
import {
  buildRuntimeNamingPreview,
  getRuntimeConfigProperty,
  mergeRuntimeConfig,
  parseRuntimeConfiguration,
  parseRuntimeConfigurationContent,
  RuntimeConfigProfileStore,
  RuntimeConfigValidationError,
  setRuntimeConfigProperty,
} from "@mdcz/runtime/config";
import {
  type Configuration,
  type DeepPartial,
  defaultConfiguration,
  getConfigurationPathDefault,
} from "@mdcz/shared/config";
import { CONFIGURATION_FILE_EXTENSIONS } from "@mdcz/shared/configCodec";

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
    configPath: pathApi.join(configDir, `${DEFAULT_PROFILE_NAME}${CONFIGURATION_FILE_EXTENSIONS.toml}`),
    databasePath: pathApi.resolve(env.MDCZ_DATABASE_PATH ?? pathApi.join(dataDir, "mdcz.sqlite")),
  };
};

export class ServerConfigValidationError extends RuntimeConfigValidationError {}

const DEFAULT_PROFILE_NAME = "default";

export interface ProfileListOutput {
  profiles: string[];
  active: string;
}

export interface ProfileImportOutput {
  profileName: string;
  overwritten: boolean;
  active: boolean;
}

export interface ProfileExportOutput {
  profileName: string;
  fileName: string;
  content: string;
}

export class ServerConfigService {
  private configuration: Configuration | null = null;
  private readonly store: RuntimeConfigProfileStore;

  constructor(private readonly paths: ServerRuntimePaths = resolveServerRuntimePaths()) {
    this.store = new RuntimeConfigProfileStore({
      configDir: paths.configDir,
      dataDir: paths.dataDir,
    });
  }

  get runtimePaths(): ServerRuntimePaths {
    return this.paths;
  }

  async load(): Promise<Configuration> {
    this.configuration = await this.runWithServerValidation(() => this.store.load());
    return this.configuration;
  }

  async get(): Promise<Configuration>;
  async get(propertyPath: string): Promise<unknown>;
  async get(propertyPath?: string): Promise<Configuration | unknown> {
    if (!this.configuration) {
      await this.load();
    }

    const configuration = this.configuration ?? defaultConfiguration;
    if (!propertyPath) {
      return configuration;
    }

    return getRuntimeConfigProperty(configuration as unknown as Record<string, unknown>, propertyPath);
  }

  async save(configuration: Configuration): Promise<Configuration> {
    this.configuration = await this.runWithServerValidation(() => this.store.save(configuration));
    return this.configuration;
  }

  defaults(): Configuration {
    return defaultConfiguration;
  }

  async update(patch: DeepPartial<Configuration>): Promise<Configuration> {
    return await this.runWithServerValidation(async () => {
      const current = await this.get();
      return await this.save(parseRuntimeConfiguration(mergeRuntimeConfig(current, patch)));
    });
  }

  async previewNaming(
    patch: DeepPartial<Configuration>,
  ): Promise<{ items: import("@mdcz/shared/types").NamingPreviewItem[] }> {
    return await this.runWithServerValidation(async () => buildRuntimeNamingPreview(await this.get(), patch));
  }

  async reset(propertyPath?: string): Promise<Configuration> {
    if (!propertyPath) {
      return await this.save(defaultConfiguration);
    }

    const resetDefault = getConfigurationPathDefault(propertyPath);
    if (!resetDefault.found) {
      throw new Error(`Path not found: ${propertyPath}`);
    }

    return await this.runWithServerValidation(async () => {
      const current = JSON.parse(JSON.stringify(await this.get())) as Record<string, unknown>;
      setRuntimeConfigProperty(current, propertyPath, resetDefault.value);
      return await this.save(parseRuntimeConfiguration(current));
    });
  }

  async import(content: string): Promise<Configuration> {
    return await this.runWithServerValidation(
      async () => await this.save(parseRuntimeConfigurationContent(content, "toml")),
    );
  }

  async export(): Promise<string> {
    return (await this.store.exportProfile(this.store.activeProfile, await this.get())).content;
  }

  async listProfiles(): Promise<ProfileListOutput> {
    return await this.store.listProfiles();
  }

  async createProfile(name: string): Promise<{ profileName: string }> {
    return await this.store.createProfile(name);
  }

  async switchProfile(name: string): Promise<Configuration> {
    this.configuration = await this.runWithServerValidation(() => this.store.switchProfile(name));
    return this.configuration;
  }

  async deleteProfile(name: string): Promise<{ profileName: string }> {
    return await this.store.deleteProfile(name);
  }

  async exportProfile(name: string): Promise<ProfileExportOutput> {
    const configuration = name === this.store.activeProfile ? await this.get() : undefined;
    return await this.store.exportProfile(name, configuration);
  }

  async importProfile(input: {
    name: string;
    content: string;
    fileName?: string;
    overwrite?: boolean;
  }): Promise<ProfileImportOutput> {
    const result = await this.runWithServerValidation(() => this.store.importProfile(input));
    if (result.active) {
      this.configuration = await this.load();
    }
    return result;
  }

  private async runWithServerValidation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof RuntimeConfigValidationError) {
        throw new ServerConfigValidationError(error.message, error.fields, error.fieldErrors);
      }
      throw error;
    }
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
