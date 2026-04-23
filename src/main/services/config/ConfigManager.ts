import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { IpcErrorCode } from "@main/ipc/errors";
import { loggerService } from "@main/services/LoggerService";
import { getProperty, mergeDeep, setProperty, toErrorMessage } from "@main/utils/common";
import { app } from "electron";
import { ComputedConfig, type ComputedConfiguration } from "./computed";
import { ConfigMigrationError, runMigrations } from "./migrator";
import {
  type Configuration,
  configurationSchema,
  type DeepPartial,
  defaultConfiguration,
  getConfigurationPathDefault,
} from "./models";

const ACTIVE_PROFILE_META_FILE = ".active-profile.json";
const CONFIG_DIRECTORY_META_FILE = ".config-directory.json";
const DEFAULT_CONFIG_DIRECTORY = "config";

export class ConfigValidationError extends Error {
  readonly code = IpcErrorCode.CONFIG_VALIDATION_ERROR;

  constructor(
    message: string,
    readonly fields: string[],
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

const CONFIG_FIELD_LABELS: Record<string, string> = {
  "naming.folderTemplate": "文件夹模板",
  "naming.fileTemplate": "文件名模板",
  "naming.assetNamingMode": "附属文件命名",
  "download.nfoNaming": "NFO 文件命名",
  "download.downloadSceneImages": "下载剧照",
  "jellyfin.userId": "Jellyfin 用户 ID",
};

const formatConfigValidationError = (fieldErrors: Record<string, string>): string => {
  const details = Object.entries(fieldErrors)
    .map(([field, message]) => `${CONFIG_FIELD_LABELS[field] ?? field}：${message}`)
    .join("；");

  return details ? `配置校验失败：${details}` : "配置校验失败";
};

const PROFILE_NAME_PATTERN = /^[\p{L}\p{N}_-]+$/u;

const normalizeProfileName = (name: string): string => {
  const normalized = name.trim();
  if (!normalized) {
    throw new Error("Profile name is required");
  }
  if (!PROFILE_NAME_PATTERN.test(normalized)) {
    throw new Error('Profile name can only contain letters, numbers, "_" and "-"');
  }
  return normalized;
};

const serializeConfiguration = (configuration: Configuration): string => `${JSON.stringify(configuration, null, 2)}\n`;

export class ConfigManager extends EventEmitter {
  private readonly logger = loggerService.getLogger("ConfigManager");

  private configuration: Configuration = defaultConfiguration;

  private readonly computedConfig = new ComputedConfig(() => this.configuration);

  private initializePromise: Promise<void> | null = null;

  private configDirectory = DEFAULT_CONFIG_DIRECTORY;

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

    return getProperty(this.configuration as unknown as Record<string, unknown>, path);
  }

  async getValidated(): Promise<Configuration> {
    return await this.get();
  }

  getComputed(): ComputedConfiguration {
    return this.computedConfig.value;
  }

  async save(partial: DeepPartial<Configuration>): Promise<void> {
    await this.ensureLoaded();

    const merged = mergeDeep(this.configuration, partial);
    const parsed = configurationSchema.safeParse(merged);

    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".");
        if (!path) {
          continue;
        }
        if (!(path in fieldErrors)) {
          fieldErrors[path] = issue.message;
        }
      }
      const fields = Object.keys(fieldErrors);
      throw new ConfigValidationError(formatConfigValidationError(fieldErrors), fields, fieldErrors);
    }

    this.configuration = parsed.data;
    this.syncConfigDirectoryFromConfiguration();
    await this.persist();
    this.computedConfig.invalidate();
    this.notify();
  }

  async reset(path?: string): Promise<void> {
    await this.ensureLoaded();

    if (!path) {
      this.configuration = defaultConfiguration;
      this.syncConfigDirectoryFromConfiguration();
      await this.persist();
      this.computedConfig.invalidate();
      this.notify();
      return;
    }

    const resetDefault = getConfigurationPathDefault(path);
    if (!resetDefault.found) {
      throw new Error(`Path not found: ${path}`);
    }

    const next = JSON.parse(JSON.stringify(this.configuration)) as Record<string, unknown>;
    setProperty(next, path, resetDefault.value);

    const parsed = configurationSchema.parse(next);
    this.configuration = parsed;
    this.syncConfigDirectoryFromConfiguration();
    await this.persist();
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
      configPath: this.getConfigPath(),
      dataDir,
    };
  }

  // ── Profile management ──

  private activeProfileName = "default";

  async listProfiles(): Promise<{ profiles: string[]; active: string }> {
    await this.ensureLoaded();
    const dataDir = this.getDataDirectory();
    await mkdir(dataDir, { recursive: true });
    const entries = await readdir(dataDir);
    const profiles = entries
      .filter((e) => e.endsWith(".json") && e !== ACTIVE_PROFILE_META_FILE)
      .map((e) => e.replace(/\.json$/u, ""))
      .filter((name) => PROFILE_NAME_PATTERN.test(name));
    if (!profiles.includes("default")) {
      profiles.unshift("default");
    }
    return { profiles, active: this.activeProfileName };
  }

  async createProfile(name: string): Promise<void> {
    await this.ensureLoaded();
    const profileName = normalizeProfileName(name);
    const filePath = this.getProfilePath(profileName);
    if (existsSync(filePath)) throw new Error(`Profile "${profileName}" already exists`);
    await mkdir(this.getDataDirectory(), { recursive: true });
    await writeFile(filePath, serializeConfiguration(defaultConfiguration), "utf8");
    this.logger.info(`Created profile: ${profileName}`);
  }

  async switchProfile(name: string): Promise<void> {
    await this.ensureLoaded();
    const profileName = normalizeProfileName(name);
    const filePath = this.getProfilePath(profileName);
    if (!existsSync(filePath)) throw new Error(`Profile "${profileName}" not found`);
    this.activeProfileName = profileName;
    await this.persistActiveProfileName();
    this.initializePromise = null;
    await this.ensureLoaded();
    this.logger.info(`Switched to profile: ${profileName}`);
    this.notify();
  }

  async deleteProfile(name: string): Promise<void> {
    await this.ensureLoaded();
    const profileName = normalizeProfileName(name);
    if (profileName === this.activeProfileName) throw new Error("Cannot delete the active profile");
    const filePath = this.getProfilePath(profileName);
    if (!existsSync(filePath)) throw new Error(`Profile "${profileName}" not found`);
    await unlink(filePath);
    this.logger.info(`Deleted profile: ${profileName}`);
  }

  async exportProfile(name: string, destinationPath: string): Promise<void> {
    await this.ensureLoaded();
    const profileName = normalizeProfileName(name);
    const configuration =
      profileName === this.activeProfileName
        ? this.configuration
        : await this.readProfileConfiguration(this.getProfilePath(profileName), profileName);

    await writeFile(destinationPath, serializeConfiguration(configuration), "utf8");
    this.logger.info(`Exported profile: ${profileName} -> ${destinationPath}`);
  }

  async importProfile(
    sourcePath: string,
    name: string,
    overwrite = false,
  ): Promise<{ profileName: string; overwritten: boolean; active: boolean }> {
    await this.ensureLoaded();

    const profileName = normalizeProfileName(name);
    const targetPath = this.getProfilePath(profileName);
    const overwritten = existsSync(targetPath);

    if (overwritten && !overwrite) {
      throw new Error(`Profile "${profileName}" already exists`);
    }

    const configuration = await this.readConfigurationFile(sourcePath);

    await mkdir(this.getDataDirectory(), { recursive: true });
    await writeFile(targetPath, serializeConfiguration(configuration), "utf8");

    const active = profileName === this.activeProfileName;
    if (active) {
      this.initializePromise = null;
      await this.ensureLoaded();
      this.notify();
    }

    this.logger.info(`${overwritten ? "Overwrote" : "Imported"} profile: ${profileName} <- ${sourcePath}`);

    return { profileName, overwritten, active };
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

  private getProfilePath(profileName: string): string {
    return join(this.getDataDirectory(), `${profileName}.json`);
  }

  private getConfigDirectoryMetaPath(): string {
    return join(app.getPath("userData"), CONFIG_DIRECTORY_META_FILE);
  }

  private getConfigPath(): string {
    return this.getProfilePath(this.activeProfileName);
  }

  private getActiveProfileMetaPath(): string {
    return join(this.getDataDirectory(), ACTIVE_PROFILE_META_FILE);
  }

  private async persistActiveProfileName(): Promise<void> {
    await mkdir(this.getDataDirectory(), { recursive: true });
    await writeFile(
      this.getActiveProfileMetaPath(),
      JSON.stringify({ active: this.activeProfileName }, null, 2),
      "utf8",
    );
  }

  private syncConfigDirectoryFromConfiguration(): void {
    const next = this.configuration.paths.configDirectory.trim() || DEFAULT_CONFIG_DIRECTORY;
    this.configDirectory = next;
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

  private async loadActiveProfileName(): Promise<void> {
    const metaPath = this.getActiveProfileMetaPath();
    if (!existsSync(metaPath)) {
      this.activeProfileName = "default";
      return;
    }

    try {
      const content = await readFile(metaPath, "utf8");
      const parsed = JSON.parse(content) as { active?: unknown };
      if (typeof parsed.active === "string") {
        this.activeProfileName = normalizeProfileName(parsed.active);
        return;
      }
    } catch (error) {
      const message = toErrorMessage(error);
      this.logger.warn(`Failed to read active profile metadata, fallback to default: ${message}`);
    }

    this.activeProfileName = "default";
  }

  private async persist(): Promise<void> {
    await mkdir(this.getDataDirectory(), { recursive: true });
    await writeFile(this.getConfigPath(), serializeConfiguration(this.configuration), "utf8");
    await this.persistActiveProfileName();
    await this.persistConfigDirectory();
  }

  private parseConfigurationContent(content: string): Configuration {
    const raw = JSON.parse(content) as Record<string, unknown>;
    runMigrations(raw);
    return configurationSchema.parse(raw);
  }

  private async readConfigurationFile(filePath: string): Promise<Configuration> {
    const content = await readFile(filePath, "utf8");
    return this.parseConfigurationContent(content);
  }

  private async readProfileConfiguration(filePath: string, profileName: string): Promise<Configuration> {
    if (!existsSync(filePath)) {
      throw new Error(`Profile "${profileName}" not found`);
    }

    return await this.readConfigurationFile(filePath);
  }

  private async loadInternal(): Promise<void> {
    await this.loadConfigDirectory();
    await mkdir(this.getDataDirectory(), { recursive: true });
    await this.loadActiveProfileName();
    await this.cleanupLegacyFiles();

    const configPath = this.getConfigPath();

    if (existsSync(configPath)) {
      try {
        const content = await readFile(configPath, "utf8");
        const raw = JSON.parse(content) as Record<string, unknown>;
        const migrationResult = runMigrations(raw);
        if (migrationResult.migrated) {
          this.logger.info(
            `Config migrated: v${migrationResult.fromVersion} → v${migrationResult.toVersion} (${migrationResult.applied.join(", ")})`,
          );
        }
        const parsed = configurationSchema.parse(raw);
        this.configuration = parsed;
        this.syncConfigDirectoryFromConfiguration();
        await this.persist();
        this.computedConfig.invalidate();
        return;
      } catch (error) {
        const message = toErrorMessage(error);
        this.logger.warn(`Failed to load config file ${configPath}; using in-memory defaults: ${message}`);
        this.configuration = defaultConfiguration;
        this.syncConfigDirectoryFromConfiguration();
        this.computedConfig.invalidate();
        return;
      }
    }

    this.configuration = defaultConfiguration;
    this.syncConfigDirectoryFromConfiguration();
    await this.persist();
    this.computedConfig.invalidate();
  }

  /**
   * Remove legacy config files that are no longer used.
   * Old versions stored configs as `fc2.json`, `default.json` (with legacy schema), etc.
   * This method validates each profile file; if it fails schema parsing, it is removed.
   * Profiles with unsupported config versions are preserved.
   */
  private async cleanupLegacyFiles(): Promise<void> {
    const dataDir = this.getDataDirectory();

    try {
      const entries = await readdir(dataDir);

      for (const entry of entries) {
        if (!entry.endsWith(".json") || entry === ACTIVE_PROFILE_META_FILE) continue;
        if (entry === `${this.activeProfileName}.json`) continue;

        const filePath = join(dataDir, entry);
        try {
          const content = await readFile(filePath, "utf8");
          const raw = JSON.parse(content) as Record<string, unknown>;
          runMigrations(raw);
          configurationSchema.parse(raw);
        } catch (error) {
          if (error instanceof ConfigMigrationError) {
            this.logger.warn(`Skipping cleanup for config file ${entry}: ${error.message}`);
            continue;
          }
          this.logger.info(`Removing legacy config file: ${entry}`);
          try {
            await unlink(filePath);
          } catch (unlinkError) {
            const msg = unlinkError instanceof Error ? unlinkError.message : String(unlinkError);
            this.logger.warn(`Failed to remove legacy file ${entry}: ${msg}`);
          }
        }
      }
    } catch {
      // Config directory may not exist yet — safe to ignore
    }
  }
}

/**
 * Main-process configuration is intentionally exposed as a module singleton.
 * Services should import this directly instead of threading it through ad-hoc deps.
 */
export const configManager = new ConfigManager();
