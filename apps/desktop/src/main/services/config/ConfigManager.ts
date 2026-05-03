import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { IpcErrorCode } from "@main/ipc/errors";
import { loggerService } from "@main/services/LoggerService";
import { toErrorMessage } from "@main/utils/common";
import {
  getRuntimeConfigProperty,
  mergeRuntimeConfig,
  parseRuntimeConfiguration,
  RuntimeConfigProfileStore,
  RuntimeConfigValidationError,
  setRuntimeConfigProperty,
} from "@mdcz/runtime/config";
import { app } from "electron";
import { ComputedConfig, type ComputedConfiguration } from "./computed";
import { type Configuration, type DeepPartial, defaultConfiguration, getConfigurationPathDefault } from "./models";

const CONFIG_DIRECTORY_META_FILE = ".config-directory.json";
const DEFAULT_CONFIG_DIRECTORY = "config";

export class ConfigValidationError extends RuntimeConfigValidationError {
  readonly code = IpcErrorCode.CONFIG_VALIDATION_ERROR;
}

export class ConfigManager extends EventEmitter {
  private readonly logger = loggerService.getLogger("ConfigManager");

  private configuration: Configuration = defaultConfiguration;

  private readonly computedConfig = new ComputedConfig(() => this.configuration);

  private initializePromise: Promise<void> | null = null;

  private configDirectory = DEFAULT_CONFIG_DIRECTORY;

  private store = this.createStore();

  private activeProfileName: string | undefined;

  async ensureLoaded(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = this.loadInternal().catch((error) => {
        this.initializePromise = null;
        throw error;
      });
    }

    await this.initializePromise;
  }

  async get(): Promise<Configuration>;
  async get(path: string): Promise<unknown>;
  async get(path?: string): Promise<Configuration | unknown> {
    await this.ensureLoaded();

    if (!path) {
      return this.configuration;
    }

    return getRuntimeConfigProperty(this.configuration as unknown as Record<string, unknown>, path);
  }

  async getValidated(): Promise<Configuration> {
    return await this.get();
  }

  getComputed(): ComputedConfiguration {
    return this.computedConfig.value;
  }

  async save(partial: DeepPartial<Configuration>): Promise<void> {
    await this.ensureLoaded();

    this.configuration = this.parseConfiguration(mergeRuntimeConfig(this.configuration, partial));
    this.syncConfigDirectoryFromConfiguration();
    this.store = this.createStore();
    this.configuration = await this.saveToStore(this.configuration);
    this.computedConfig.invalidate();
    this.notify();
  }

  async reset(path?: string): Promise<void> {
    await this.ensureLoaded();

    if (!path) {
      this.configuration = defaultConfiguration;
      this.syncConfigDirectoryFromConfiguration();
      this.store = this.createStore();
      this.configuration = await this.saveToStore(this.configuration);
      this.computedConfig.invalidate();
      this.notify();
      return;
    }

    const resetDefault = getConfigurationPathDefault(path);
    if (!resetDefault.found) {
      throw new Error(`Path not found: ${path}`);
    }

    const next = JSON.parse(JSON.stringify(this.configuration)) as Record<string, unknown>;
    setRuntimeConfigProperty(next, path, resetDefault.value);

    this.configuration = this.parseConfiguration(next);
    this.syncConfigDirectoryFromConfiguration();
    this.store = this.createStore();
    this.configuration = await this.saveToStore(this.configuration);
    this.computedConfig.invalidate();
    this.notify();
  }

  onChange(listener: (configuration: Configuration) => void): () => void {
    this.on("change", listener);
    return () => {
      this.off("change", listener);
    };
  }

  list(): { configPath: string; dataDir: string } {
    const dataDir = this.getDataDirectory();
    return {
      configPath: this.store.configPath,
      dataDir,
    };
  }

  async listProfiles(): Promise<{ profiles: string[]; active: string }> {
    await this.ensureLoaded();
    return await this.store.listProfiles();
  }

  async createProfile(name: string): Promise<void> {
    await this.ensureLoaded();
    const result = await this.store.createProfile(name);
    this.logger.info(`Created profile: ${result.profileName}`);
  }

  async switchProfile(name: string): Promise<void> {
    await this.ensureLoaded();
    this.configuration = await this.loadFromStore(() => this.store.switchProfile(name));
    this.activeProfileName = this.store.activeProfile;
    this.syncConfigDirectoryFromConfiguration();
    this.store = this.createStore();
    this.configuration = await this.saveToStore(this.configuration);
    this.computedConfig.invalidate();
    this.logger.info(`Switched to profile: ${name}`);
    this.notify();
  }

  async deleteProfile(name: string): Promise<void> {
    await this.ensureLoaded();
    const result = await this.store.deleteProfile(name);
    this.logger.info(`Deleted profile: ${result.profileName}`);
  }

  async exportProfile(name: string, destinationPath: string): Promise<void> {
    await this.ensureLoaded();
    const configuration = name === this.store.activeProfile ? this.configuration : undefined;
    await this.store.exportProfileToFile(name, destinationPath, configuration);
    this.logger.info(`Exported profile: ${name} -> ${destinationPath}`);
  }

  async importProfile(
    sourcePath: string,
    name: string,
    overwrite = false,
  ): Promise<{ profileName: string; overwritten: boolean; active: boolean }> {
    await this.ensureLoaded();

    const result = await this.loadFromStore(() =>
      this.store.importProfileFromFile({
        sourcePath,
        name,
        overwrite,
      }),
    );

    if (result.active) {
      this.configuration = await this.loadFromStore(() => this.store.load());
      this.activeProfileName = this.store.activeProfile;
      this.syncConfigDirectoryFromConfiguration();
      this.store = this.createStore();
      this.configuration = await this.saveToStore(this.configuration);
      this.computedConfig.invalidate();
      this.notify();
    }

    this.logger.info(
      `${result.overwritten ? "Overwrote" : "Imported"} profile: ${result.profileName} <- ${sourcePath}`,
    );

    return result;
  }

  private notify(): void {
    this.emit("change", this.configuration);
  }

  private getDataDirectory(): string {
    if (isAbsolute(this.configDirectory)) {
      return this.configDirectory;
    }
    return join(app.getPath("userData"), this.configDirectory);
  }

  private getConfigDirectoryMetaPath(): string {
    return join(app.getPath("userData"), CONFIG_DIRECTORY_META_FILE);
  }

  private syncConfigDirectoryFromConfiguration(): void {
    const next = this.configuration.paths.configDirectory.trim() || DEFAULT_CONFIG_DIRECTORY;
    this.configDirectory = next;
  }

  private createStore(): RuntimeConfigProfileStore {
    return new RuntimeConfigProfileStore({
      configDir: this.getDataDirectory(),
      activeProfileName: this.activeProfileName,
    });
  }

  private async loadConfigDirectory(): Promise<void> {
    const metaPath = this.getConfigDirectoryMetaPath();
    if (!existsSync(metaPath)) {
      this.configDirectory = DEFAULT_CONFIG_DIRECTORY;
      return;
    }

    try {
      const content = await readFile(metaPath, "utf8");
      const parsed = JSON.parse(content) as { directory?: unknown };
      if (typeof parsed.directory === "string") {
        this.configDirectory = parsed.directory.trim() || DEFAULT_CONFIG_DIRECTORY;
        return;
      }
    } catch (error) {
      const message = toErrorMessage(error);
      this.logger.warn(`Failed to read config directory metadata, fallback to default: ${message}`);
    }

    this.configDirectory = DEFAULT_CONFIG_DIRECTORY;
  }

  private async persistConfigDirectory(): Promise<void> {
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(
      this.getConfigDirectoryMetaPath(),
      JSON.stringify({ directory: this.configDirectory }, null, 2),
      "utf8",
    );
  }

  private async saveToStore(configuration: Configuration): Promise<Configuration> {
    const saved = await this.loadFromStore(() => this.store.save(configuration));
    await this.persistConfigDirectory();
    return saved;
  }

  private async loadInternal(): Promise<void> {
    await this.loadConfigDirectory();
    this.store = this.createStore();
    await this.store.cleanupInvalidNonActiveProfiles(this.logger);

    try {
      this.configuration = await this.loadFromStore(() => this.store.load());
      this.activeProfileName = this.store.activeProfile;
      this.syncConfigDirectoryFromConfiguration();
      this.store = this.createStore();
      this.configuration = await this.saveToStore(this.configuration);
      this.computedConfig.invalidate();
    } catch (error) {
      const message = toErrorMessage(error);
      this.logger.warn(`Failed to load config; using in-memory defaults: ${message}`);
      this.configuration = defaultConfiguration;
      this.syncConfigDirectoryFromConfiguration();
      this.store = this.createStore();
      this.computedConfig.invalidate();
    }
  }

  private parseConfiguration(value: unknown): Configuration {
    try {
      return parseRuntimeConfiguration(value);
    } catch (error) {
      if (error instanceof RuntimeConfigValidationError) {
        throw new ConfigValidationError(error.message, error.fields, error.fieldErrors);
      }
      throw error;
    }
  }

  private async loadFromStore<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof RuntimeConfigValidationError) {
        throw new ConfigValidationError(error.message, error.fields, error.fieldErrors);
      }
      throw error;
    }
  }
}

/**
 * Main-process configuration is intentionally exposed as a module singleton.
 * Services should import this directly instead of threading it through ad-hoc deps.
 */
export const configManager = new ConfigManager();
