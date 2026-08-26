import { homedir } from "node:os";
import path from "node:path";
import {
  type RuntimeConfigChangeEvent,
  type RuntimeConfigDiagnosticEvent,
  RuntimeConfigProfileStore,
  RuntimeConfigService,
  RuntimeConfigValidationError,
} from "@mdcz/runtime/config";
import type { Configuration, DeepPartial } from "@mdcz/shared/config";
import { CONFIGURATION_FILE_EXTENSIONS } from "@mdcz/shared/configCodec";
import { toConfigValidationDomainError } from "@mdcz/shared/error";

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

export class ServerConfigValidationError extends RuntimeConfigValidationError {
  readonly domainError = toConfigValidationDomainError({
    message: this.message,
    fields: this.fields,
    fieldErrors: this.fieldErrors,
  });
}

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
  private readonly config: RuntimeConfigService;
  private readonly changeListeners = new Set<(event: RuntimeConfigChangeEvent) => void>();
  private readonly diagnosticListeners = new Set<(event: RuntimeConfigDiagnosticEvent) => void>();

  constructor(private readonly paths: ServerRuntimePaths = resolveServerRuntimePaths()) {
    this.config = new RuntimeConfigService({
      store: new RuntimeConfigProfileStore({
        configDir: paths.configDir,
        dataDir: paths.dataDir,
      }),
      mapValidationError: (error) => new ServerConfigValidationError(error.message, error.fields, error.fieldErrors),
    });
    this.config.onChange((event) => {
      for (const listener of this.changeListeners) listener(event);
    });
    this.config.onDiagnostic((event) => {
      for (const listener of this.diagnosticListeners) listener(event);
    });
  }

  get runtimePaths(): ServerRuntimePaths {
    return this.paths;
  }

  async load(): Promise<Configuration> {
    return await this.config.load();
  }

  onChange(listener: (event: RuntimeConfigChangeEvent) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  onDiagnostic(listener: (event: RuntimeConfigDiagnosticEvent) => void): () => void {
    this.diagnosticListeners.add(listener);
    return () => this.diagnosticListeners.delete(listener);
  }

  async startWatching(): Promise<void> {
    await this.config.startWatching();
  }

  async stopWatching(): Promise<void> {
    await this.config.stopWatching();
  }

  async get(): Promise<Configuration>;
  async get(propertyPath: string): Promise<unknown>;
  async get(propertyPath?: string): Promise<Configuration | unknown> {
    return propertyPath ? await this.config.get(propertyPath) : await this.config.get();
  }

  async save(configuration: Configuration): Promise<Configuration> {
    return await this.config.saveFull(configuration);
  }

  defaults(): Configuration {
    return this.config.defaults();
  }

  async update(patch: DeepPartial<Configuration>): Promise<Configuration> {
    return await this.config.update(patch);
  }

  async previewNaming(
    patch: DeepPartial<Configuration>,
  ): Promise<{ items: import("@mdcz/shared/types").NamingPreviewItem[] }> {
    return await this.config.previewNaming(patch);
  }

  async reset(propertyPath?: string): Promise<Configuration> {
    return await this.config.reset(propertyPath);
  }

  async import(content: string): Promise<Configuration> {
    return await this.config.import(content);
  }

  async export(): Promise<string> {
    return await this.config.export();
  }

  async listProfiles(): Promise<ProfileListOutput> {
    return await this.config.listProfiles();
  }

  async createProfile(name: string): Promise<{ profileName: string }> {
    return await this.config.createProfile(name);
  }

  async switchProfile(name: string): Promise<Configuration> {
    return await this.config.switchProfile(name);
  }

  async deleteProfile(name: string): Promise<{ profileName: string }> {
    return await this.config.deleteProfile(name);
  }

  async exportProfile(name: string): Promise<ProfileExportOutput> {
    return (await this.config.exportProfile(name)) as ProfileExportOutput;
  }

  async importProfile(input: {
    name: string;
    content: string;
    fileName?: string;
    overwrite?: boolean;
  }): Promise<ProfileImportOutput> {
    return await this.config.importProfile(input);
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
