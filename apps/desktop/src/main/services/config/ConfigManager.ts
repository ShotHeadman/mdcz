import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { getDesktopUserDataPath } from "@main/appIdentity";
import { IpcErrorCode } from "@main/ipc/errors";
import { loggerService } from "@main/services/LoggerService";
import { toErrorMessage } from "@main/utils/common";
import { RuntimeConfigProfileStore, RuntimeConfigService, RuntimeConfigValidationError } from "@mdcz/runtime/config";
import { type Configuration, type DeepPartial, defaultConfiguration } from "@mdcz/shared/config";
import { toConfigValidationDomainError } from "@mdcz/shared/error";
import { ComputedConfig, type ComputedConfiguration } from "./computed";

const CONFIG_DIRECTORY_META_FILE = ".config-directory.json";
const DEFAULT_CONFIG_DIRECTORY = "config";

export class ConfigValidationError extends RuntimeConfigValidationError {
  readonly code = IpcErrorCode.CONFIG_VALIDATION_ERROR;
  readonly domainError = toConfigValidationDomainError({
    message: this.message,
    fields: this.fields,
    fieldErrors: this.fieldErrors,
  });
}

export class ConfigManager extends EventEmitter {
  private readonly logger = loggerService.getLogger("ConfigManager");

  private configuration: Configuration = defaultConfiguration;

  private readonly computedConfig = new ComputedConfig(() => this.configuration);

  private initializePromise: Promise<void> | null = null;

  private configDirectory = DEFAULT_CONFIG_DIRECTORY;
  private saveSnapshot: {
    configuration: Configuration;
    configDirectory: string;
    activeProfileName: string | undefined;
  } | null = null;

  private readonly config = new RuntimeConfigService({
    store: this.createStore(),
    onBeforeSave: (configuration) => {
      this.saveSnapshot = {
        configuration: this.configuration,
        configDirectory: this.configDirectory,
        activeProfileName: this.activeProfileName,
      };
      this.configuration = configuration;
      this.syncConfigDirectoryFromConfiguration();
      this.config.replaceStore(this.createStore());
    },
    onSaveError: () => {
      const snapshot = this.saveSnapshot;
      if (!snapshot) return;
      this.configuration = snapshot.configuration;
      this.configDirectory = snapshot.configDirectory;
      this.activeProfileName = snapshot.activeProfileName;
      this.config.replaceStore(this.createStore());
      this.computedConfig.invalidate();
      this.saveSnapshot = null;
    },
    onAfterSave: async (configuration) => {
      await this.persistConfigDirectory();
      const applied = this.applyLoadedConfiguration(configuration);
      await this.rebindRuntimeStoreIfNeeded();
      this.saveSnapshot = null;
      return applied;
    },
    onAfterLoad: async (configuration) => {
      const applied = this.applyLoadedConfiguration(configuration);
      await this.rebindRuntimeStoreIfNeeded();
      return applied;
    },
    mapValidationError: (error) => new ConfigValidationError(error.message, error.fields, error.fieldErrors),
  });

  private activeProfileName: string | undefined;

  constructor() {
    super();
    this.config.onChange((event) => {
      if (event.source !== "watch" && event.source !== "switch") return;
      this.applyLoadedConfiguration(event.configuration);
      void this.rebindRuntimeStoreIfNeeded();
      this.notify();
    });
    this.config.onDiagnostic((event) => {
      this.logger.warn(`Configuration ${event.kind} for profile ${event.profileName}: ${event.message}`);
    });
  }

  async ensureLoaded(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = this.loadInternal().catch((error) => {
        this.initializePromise = null;
        throw error;
      });
    }

    await this.initializePromise;
  }

  async startWatching(): Promise<void> {
    await this.ensureLoaded();
    await this.config.startWatching();
  }

  async stopWatching(): Promise<void> {
    await this.config.stopWatching();
  }

  async get(): Promise<Configuration>;
  async get(path: string): Promise<unknown>;
  async get(path?: string): Promise<Configuration | unknown> {
    await this.ensureLoaded();

    if (!path) {
      return this.configuration;
    }

    return await this.config.get(path);
  }

  async getValidated(): Promise<Configuration> {
    return await this.get();
  }

  getComputed(): ComputedConfiguration {
    return this.computedConfig.value;
  }

  async save(partial: DeepPartial<Configuration>): Promise<void> {
    await this.ensureLoaded();

    await this.config.update(partial);
    this.notify();
  }

  async reset(path?: string): Promise<void> {
    await this.ensureLoaded();

    await this.config.reset(path);
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
      configPath: this.config.configPath,
      dataDir,
    };
  }

  async listProfiles(): Promise<{ profiles: string[]; active: string }> {
    await this.ensureLoaded();
    return await this.config.listProfiles();
  }

  async createProfile(name: string): Promise<void> {
    await this.ensureLoaded();
    const result = await this.config.createProfile(name);
    this.logger.info(`Created profile: ${result.profileName}`);
  }

  async switchProfile(name: string): Promise<void> {
    await this.ensureLoaded();
    await this.config.switchProfile(name);
    this.syncConfigDirectoryFromConfiguration();
    this.config.replaceStore(this.createStore());
    await this.config.saveFull(this.configuration);
    this.logger.info(`Switched to profile: ${name}`);
    this.notify();
  }

  async deleteProfile(name: string): Promise<void> {
    await this.ensureLoaded();
    const result = await this.config.deleteProfile(name);
    this.logger.info(`Deleted profile: ${result.profileName}`);
  }

  async exportProfile(name: string, destinationPath: string): Promise<void> {
    await this.ensureLoaded();
    await this.config.exportProfile(name, destinationPath);
    this.logger.info(`Exported profile: ${name} -> ${destinationPath}`);
  }

  async importProfile(
    sourcePath: string,
    name: string,
    overwrite = false,
  ): Promise<{ profileName: string; overwritten: boolean; active: boolean }> {
    await this.ensureLoaded();

    const result = await this.config.importProfileFromFile({
      sourcePath,
      name,
      overwrite,
    });

    if (result.active) {
      this.syncConfigDirectoryFromConfiguration();
      this.config.replaceStore(this.createStore());
      await this.config.saveFull(this.configuration);
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
    return join(getDesktopUserDataPath(), this.configDirectory);
  }

  private getConfigDirectoryMetaPath(): string {
    return join(getDesktopUserDataPath(), CONFIG_DIRECTORY_META_FILE);
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
    await mkdir(getDesktopUserDataPath(), { recursive: true });
    await writeFile(
      this.getConfigDirectoryMetaPath(),
      JSON.stringify({ directory: this.configDirectory }, null, 2),
      "utf8",
    );
  }

  private async loadInternal(): Promise<void> {
    await this.loadConfigDirectory();
    this.config.replaceStore(this.createStore());
    await this.config.cleanupInvalidNonActiveProfiles(this.logger);

    try {
      await this.config.load();
      this.syncConfigDirectoryFromConfiguration();
      this.config.replaceStore(this.createStore());
      await this.config.saveFull(this.configuration);
    } catch (error) {
      const message = toErrorMessage(error);
      this.logger.warn(`Failed to load config; using in-memory defaults: ${message}`);
      this.configuration = defaultConfiguration;
      this.syncConfigDirectoryFromConfiguration();
      this.config.replaceStore(this.createStore());
      this.computedConfig.invalidate();
    }
  }

  private applyLoadedConfiguration(configuration: Configuration): Configuration {
    this.configuration = configuration;
    this.activeProfileName = this.config.activeProfile;
    this.syncConfigDirectoryFromConfiguration();
    this.computedConfig.invalidate();
    return this.configuration;
  }

  private async rebindRuntimeStoreIfNeeded(): Promise<void> {
    const expectedDirectory = this.getDataDirectory();
    if (this.config.configDirectory !== expectedDirectory) {
      this.config.replaceStore(this.createStore());
    }
  }
}

/**
 * Main-process configuration is intentionally exposed as a module singleton.
 * Services should import this directly instead of threading it through ad-hoc deps.
 */
export const configManager = new ConfigManager();
