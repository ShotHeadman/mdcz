import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type Configuration,
  configurationSchema,
  type DeepPartial,
  defaultConfiguration,
  getConfigurationPathDefault,
} from "@mdcz/shared/config";
import {
  CONFIGURATION_FILE_EXTENSIONS,
  type ConfigurationFileFormat,
  inferConfigurationFileFormat,
  parseConfigurationContent,
  serializeConfiguration,
} from "@mdcz/shared/configCodec";
import type { NamingPreviewItem } from "@mdcz/shared/types";
import { NamingEngine } from "../scrape/organize/NamingEngine";

export const RUNTIME_ACTIVE_PROFILE_META_FILE = ".active-profile.json";
export const RUNTIME_DEFAULT_PROFILE_NAME = "default";
export const RUNTIME_PROFILE_NAME_PATTERN = /^[\p{L}\p{N}_-]+$/u;

const CONFIG_FIELD_LABELS: Record<string, string> = {
  "download.downloadSceneImages": "下载剧照",
  "download.nfoNaming": "NFO 文件命名",
  "jellyfin.userId": "Jellyfin 用户 ID",
  "naming.assetNamingMode": "附属文件命名",
  "naming.fileTemplate": "文件名模板",
  "naming.folderTemplate": "文件夹模板",
};

export class RuntimeConfigValidationError extends Error {
  constructor(
    message: string,
    readonly fields: string[],
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

export const formatRuntimeConfigValidationError = (fieldErrors: Record<string, string>): string => {
  const details = Object.entries(fieldErrors)
    .map(([field, message]) => `${CONFIG_FIELD_LABELS[field] ?? field}：${message}`)
    .join("；");

  return details ? `配置校验失败：${details}` : "配置校验失败";
};

export const normalizeRuntimeProfileName = (name: string): string => {
  const normalized = name.trim();
  if (!normalized) {
    throw new Error("Profile name is required");
  }
  if (!RUNTIME_PROFILE_NAME_PATTERN.test(normalized)) {
    throw new Error('Profile name can only contain letters, numbers, "_" and "-"');
  }
  return normalized;
};

export const getRuntimeConfigProperty = (obj: Record<string, unknown>, propertyPath: string): unknown => {
  const parts = propertyPath.split(".");
  let cursor: unknown = obj;
  for (const part of parts) {
    if (cursor == null || typeof cursor !== "object") {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
};

export const setRuntimeConfigProperty = (obj: Record<string, unknown>, propertyPath: string, value: unknown): void => {
  const parts = propertyPath.split(".");
  let cursor = obj;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== "object") {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  const tail = parts.at(-1);
  if (tail) {
    cursor[tail] = value;
  }
};

export const parseRuntimeConfiguration = (value: unknown): Configuration => {
  const parsed = configurationSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const issuePath = issue.path.join(".");
    if (issuePath && !(issuePath in fieldErrors)) {
      fieldErrors[issuePath] = issue.message;
    }
  }
  throw new RuntimeConfigValidationError(
    formatRuntimeConfigValidationError(fieldErrors),
    Object.keys(fieldErrors),
    fieldErrors,
  );
};

export const parseRuntimeConfigurationContent = (content: string, format: ConfigurationFileFormat): Configuration => {
  try {
    return parseConfigurationContent(content, format);
  } catch (error) {
    const issues = Array.isArray((error as { issues?: unknown }).issues)
      ? (error as { issues: Array<{ path?: unknown[]; message?: unknown }> }).issues
      : null;
    if (!issues) {
      throw error;
    }

    const fieldErrors: Record<string, string> = {};
    for (const issue of issues) {
      const issuePath = Array.isArray(issue.path) ? issue.path.join(".") : "";
      if (issuePath && !(issuePath in fieldErrors)) {
        fieldErrors[issuePath] = typeof issue.message === "string" ? issue.message : "Invalid value";
      }
    }
    throw new RuntimeConfigValidationError(
      formatRuntimeConfigValidationError(fieldErrors),
      Object.keys(fieldErrors),
      fieldErrors,
    );
  }
};

export const mergeRuntimeConfig = <T>(base: T, patch: DeepPartial<T>): T => {
  if (
    Array.isArray(base) ||
    Array.isArray(patch) ||
    typeof base !== "object" ||
    base === null ||
    typeof patch !== "object" ||
    patch === null
  ) {
    return patch as T;
  }

  const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) {
      continue;
    }
    merged[key] = key in merged ? mergeRuntimeConfig(merged[key], value) : value;
  }
  return merged as T;
};

const namingPreviewEngine = new NamingEngine();

export const buildRuntimeNamingPreview = (
  configuration: Configuration,
  patch: DeepPartial<Configuration> = {},
): { items: NamingPreviewItem[] } => {
  const config = parseRuntimeConfiguration(mergeRuntimeConfig(configuration, patch));

  return {
    items: namingPreviewEngine.buildPreview(config),
  };
};

export interface RuntimeConfigProfileStoreOptions {
  configDir: string;
  dataDir?: string;
  activeProfileName?: string;
}

export interface RuntimeProfileListOutput {
  profiles: string[];
  active: string;
}

export interface RuntimeProfileImportOutput {
  profileName: string;
  overwritten: boolean;
  active: boolean;
}

export interface RuntimeProfileExportOutput {
  profileName: string;
  fileName: string;
  content: string;
}

export interface RuntimeCleanupLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface RuntimeConfigServiceOptions {
  store: RuntimeConfigProfileStore;
  onBeforeLoad?: () => Promise<void> | void;
  onAfterLoad?: (configuration: Configuration) => Promise<Configuration | undefined> | Configuration | undefined;
  onBeforeSave?: (configuration: Configuration) => Promise<void> | void;
  onAfterSave?: (configuration: Configuration) => Promise<Configuration | undefined> | Configuration | undefined;
  mapValidationError?: (error: RuntimeConfigValidationError) => Error;
}

export class RuntimeConfigService {
  private configuration: Configuration | null = null;
  private store: RuntimeConfigProfileStore;

  constructor(private readonly options: RuntimeConfigServiceOptions) {
    this.store = options.store;
  }

  get activeProfile(): string {
    return this.store.activeProfile;
  }

  get configPath(): string {
    return this.store.configPath;
  }

  replaceStore(store: RuntimeConfigProfileStore): void {
    this.store = store;
  }

  async load(): Promise<Configuration> {
    this.configuration = await this.runWithValidation(async () => {
      await this.options.onBeforeLoad?.();
      const loaded = await this.store.load();
      return await this.applyAfterLoad(loaded);
    });
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

  async saveFull(configuration: Configuration): Promise<Configuration> {
    this.configuration = await this.runWithValidation(async () => {
      const parsed = parseRuntimeConfiguration(configuration);
      await this.options.onBeforeSave?.(parsed);
      const saved = await this.store.save(parsed);
      return await this.applyAfterSave(saved);
    });
    return this.configuration;
  }

  defaults(): Configuration {
    return defaultConfiguration;
  }

  async update(patch: DeepPartial<Configuration>): Promise<Configuration> {
    return await this.runWithValidation(async () => {
      const current = await this.get();
      return await this.saveFull(parseRuntimeConfiguration(mergeRuntimeConfig(current, patch)));
    });
  }

  async previewNaming(patch: DeepPartial<Configuration>): Promise<{ items: NamingPreviewItem[] }> {
    return await this.runWithValidation(async () => buildRuntimeNamingPreview(await this.get(), patch));
  }

  async reset(propertyPath?: string): Promise<Configuration> {
    if (!propertyPath) {
      return await this.saveFull(defaultConfiguration);
    }

    const resetDefault = getConfigurationPathDefault(propertyPath);
    if (!resetDefault.found) {
      throw new Error(`Path not found: ${propertyPath}`);
    }

    return await this.runWithValidation(async () => {
      const current = JSON.parse(JSON.stringify(await this.get())) as Record<string, unknown>;
      setRuntimeConfigProperty(current, propertyPath, resetDefault.value);
      return await this.saveFull(parseRuntimeConfiguration(current));
    });
  }

  async import(content: string, format: ConfigurationFileFormat = "toml"): Promise<Configuration> {
    return await this.runWithValidation(
      async () => await this.saveFull(parseRuntimeConfigurationContent(content, format)),
    );
  }

  async export(): Promise<string> {
    return (await this.store.exportProfile(this.store.activeProfile, await this.get())).content;
  }

  async listProfiles(): Promise<RuntimeProfileListOutput> {
    return await this.store.listProfiles();
  }

  async createProfile(name: string): Promise<{ profileName: string }> {
    return await this.store.createProfile(name);
  }

  async switchProfile(name: string): Promise<Configuration> {
    this.configuration = await this.runWithValidation(async () => {
      const switched = await this.store.switchProfile(name);
      return await this.applyAfterLoad(switched);
    });
    return this.configuration;
  }

  async deleteProfile(name: string): Promise<{ profileName: string }> {
    return await this.store.deleteProfile(name);
  }

  async exportProfile(name: string, destinationPath?: string): Promise<RuntimeProfileExportOutput | undefined> {
    const configuration = name === this.store.activeProfile ? await this.get() : undefined;
    if (destinationPath) {
      await this.store.exportProfileToFile(name, destinationPath, configuration);
      return;
    }
    return await this.store.exportProfile(name, configuration);
  }

  async importProfile(input: {
    name: string;
    content: string;
    fileName?: string;
    overwrite?: boolean;
  }): Promise<RuntimeProfileImportOutput> {
    const result = await this.runWithValidation(() => this.store.importProfile(input));
    if (result.active) {
      this.configuration = await this.load();
    }
    return result;
  }

  async importProfileFromFile(input: {
    sourcePath: string;
    name: string;
    overwrite?: boolean;
  }): Promise<RuntimeProfileImportOutput> {
    const result = await this.runWithValidation(() => this.store.importProfileFromFile(input));
    if (result.active) {
      this.configuration = await this.load();
    }
    return result;
  }

  async cleanupInvalidNonActiveProfiles(logger?: RuntimeCleanupLogger): Promise<void> {
    await this.store.cleanupInvalidNonActiveProfiles(logger);
  }

  private async applyAfterLoad(configuration: Configuration): Promise<Configuration> {
    const next = await this.options.onAfterLoad?.(configuration);
    return next ?? configuration;
  }

  private async applyAfterSave(configuration: Configuration): Promise<Configuration> {
    const next = await this.options.onAfterSave?.(configuration);
    return next ?? configuration;
  }

  private async runWithValidation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof RuntimeConfigValidationError && this.options.mapValidationError) {
        throw this.options.mapValidationError(error);
      }
      throw error;
    }
  }
}

export class RuntimeConfigProfileStore {
  private activeProfileName: string;
  private activeProfileLoaded = false;

  constructor(private readonly options: RuntimeConfigProfileStoreOptions) {
    this.activeProfileName = options.activeProfileName
      ? normalizeRuntimeProfileName(options.activeProfileName)
      : RUNTIME_DEFAULT_PROFILE_NAME;
    this.activeProfileLoaded = Boolean(options.activeProfileName);
  }

  get activeProfile(): string {
    return this.activeProfileName;
  }

  get configPath(): string {
    return this.getProfilePath(this.activeProfileName);
  }

  async load(): Promise<Configuration> {
    await mkdir(this.options.configDir, { recursive: true });
    if (this.options.dataDir) {
      await mkdir(this.options.dataDir, { recursive: true });
    }
    await this.loadActiveProfileName();
    const profilePath = this.getActiveProfilePath();

    if (!existsSync(profilePath)) {
      await this.save(defaultConfiguration);
      return defaultConfiguration;
    }

    return await this.readConfigurationFile(profilePath);
  }

  async save(configuration: Configuration): Promise<Configuration> {
    const parsed = parseRuntimeConfiguration(configuration);
    await mkdir(this.options.configDir, { recursive: true });
    if (this.options.dataDir) {
      await mkdir(this.options.dataDir, { recursive: true });
    }
    await writeFile(this.getProfilePath(this.activeProfileName), serializeConfiguration(parsed), "utf8");
    await this.persistActiveProfileName();
    return parsed;
  }

  async listProfiles(): Promise<RuntimeProfileListOutput> {
    await mkdir(this.options.configDir, { recursive: true });
    if (!this.activeProfileLoaded) {
      await this.loadActiveProfileName();
    }
    const entries = await readdir(this.options.configDir);
    const profiles = entries
      .filter((entry) => this.isProfileConfigFile(entry) && entry !== RUNTIME_ACTIVE_PROFILE_META_FILE)
      .map((entry) => entry.replace(/\.(json|toml)$/u, ""))
      .filter((name) => RUNTIME_PROFILE_NAME_PATTERN.test(name));
    if (!profiles.includes(RUNTIME_DEFAULT_PROFILE_NAME)) {
      profiles.unshift(RUNTIME_DEFAULT_PROFILE_NAME);
    }
    return { profiles, active: this.activeProfileName };
  }

  async createProfile(name: string): Promise<{ profileName: string }> {
    const profileName = normalizeRuntimeProfileName(name);
    const filePath = this.getProfilePath(profileName);
    if (existsSync(filePath) || existsSync(this.getLegacyProfilePath(profileName))) {
      throw new Error(`Profile "${profileName}" already exists`);
    }
    await mkdir(this.options.configDir, { recursive: true });
    await writeFile(filePath, serializeConfiguration(defaultConfiguration), "utf8");
    return { profileName };
  }

  async switchProfile(name: string): Promise<Configuration> {
    const profileName = normalizeRuntimeProfileName(name);
    const filePath = this.getExistingProfilePath(profileName);
    if (!existsSync(filePath)) {
      throw new Error(`Profile "${profileName}" not found`);
    }
    this.activeProfileName = profileName;
    this.activeProfileLoaded = true;
    await this.persistActiveProfileName();
    return await this.readConfigurationFile(filePath);
  }

  async deleteProfile(name: string): Promise<{ profileName: string }> {
    const profileName = normalizeRuntimeProfileName(name);
    if (!this.activeProfileLoaded) {
      await this.loadActiveProfileName();
    }
    if (profileName === this.activeProfileName) {
      throw new Error("Cannot delete the active profile");
    }
    const filePath = this.getExistingProfilePath(profileName);
    if (!existsSync(filePath)) {
      throw new Error(`Profile "${profileName}" not found`);
    }
    await unlink(filePath);
    return { profileName };
  }

  async exportProfile(name: string, configuration?: Configuration): Promise<RuntimeProfileExportOutput> {
    const profileName = normalizeRuntimeProfileName(name);
    const exportedConfiguration =
      profileName === this.activeProfileName && configuration
        ? configuration
        : await this.readProfileConfiguration(this.getExistingProfilePath(profileName), profileName);

    return {
      profileName,
      fileName: `${profileName}${CONFIGURATION_FILE_EXTENSIONS.toml}`,
      content: serializeConfiguration(exportedConfiguration, "toml"),
    };
  }

  async exportProfileToFile(name: string, destinationPath: string, configuration?: Configuration): Promise<void> {
    const exported = await this.exportProfile(name, configuration);
    await writeFile(
      destinationPath,
      serializeConfiguration(
        parseRuntimeConfigurationContent(exported.content, "toml"),
        inferConfigurationFileFormat(destinationPath),
      ),
      "utf8",
    );
  }

  async importProfile(input: {
    name: string;
    content: string;
    fileName?: string;
    overwrite?: boolean;
  }): Promise<RuntimeProfileImportOutput> {
    const profileName = normalizeRuntimeProfileName(input.name);
    const targetPath = this.getProfilePath(profileName);
    const overwritten = existsSync(targetPath) || existsSync(this.getLegacyProfilePath(profileName));

    if (overwritten && !input.overwrite) {
      throw new Error(`Profile "${profileName}" already exists`);
    }

    const configuration = parseRuntimeConfigurationContent(
      input.content,
      input.fileName ? inferConfigurationFileFormat(input.fileName) : "toml",
    );
    await mkdir(this.options.configDir, { recursive: true });
    await writeFile(targetPath, serializeConfiguration(configuration), "utf8");

    return { profileName, overwritten, active: profileName === this.activeProfileName };
  }

  async importProfileFromFile(input: {
    sourcePath: string;
    name: string;
    overwrite?: boolean;
  }): Promise<RuntimeProfileImportOutput> {
    const content = await readFile(input.sourcePath, "utf8");
    const configuration = parseRuntimeConfigurationContent(content, inferConfigurationFileFormat(input.sourcePath));
    return await this.importProfile({
      name: input.name,
      content: serializeConfiguration(configuration, "toml"),
      overwrite: input.overwrite,
    });
  }

  async cleanupInvalidNonActiveProfiles(logger?: RuntimeCleanupLogger): Promise<void> {
    await mkdir(this.options.configDir, { recursive: true });
    if (!this.activeProfileLoaded) {
      await this.loadActiveProfileName();
    }

    const entries = await readdir(this.options.configDir);
    for (const entry of entries) {
      if (!this.isProfileConfigFile(entry) || entry === RUNTIME_ACTIVE_PROFILE_META_FILE) continue;
      if (entry === `${this.activeProfileName}.json` || entry === `${this.activeProfileName}.toml`) continue;

      const filePath = path.join(this.options.configDir, entry);
      try {
        await this.readConfigurationFile(filePath);
      } catch {
        logger?.info(`Removing legacy config file: ${entry}`);
        try {
          await unlink(filePath);
        } catch (error) {
          logger?.warn(
            `Failed to remove legacy file ${entry}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  getProfilePath(profileName: string): string {
    return path.join(this.options.configDir, `${profileName}${CONFIGURATION_FILE_EXTENSIONS.toml}`);
  }

  getLegacyProfilePath(profileName: string): string {
    return path.join(this.options.configDir, `${profileName}${CONFIGURATION_FILE_EXTENSIONS.json}`);
  }

  getExistingProfilePath(profileName: string): string {
    const tomlPath = this.getProfilePath(profileName);
    if (existsSync(tomlPath)) {
      return tomlPath;
    }
    return this.getLegacyProfilePath(profileName);
  }

  private getActiveProfilePath(): string {
    return this.getExistingProfilePath(this.activeProfileName);
  }

  private isProfileConfigFile(entry: string): boolean {
    return entry.endsWith(CONFIGURATION_FILE_EXTENSIONS.toml) || entry.endsWith(CONFIGURATION_FILE_EXTENSIONS.json);
  }

  private getActiveProfileMetaPath(): string {
    return path.join(this.options.configDir, RUNTIME_ACTIVE_PROFILE_META_FILE);
  }

  private async loadActiveProfileName(): Promise<void> {
    const metaPath = this.getActiveProfileMetaPath();
    if (!existsSync(metaPath)) {
      this.activeProfileName = RUNTIME_DEFAULT_PROFILE_NAME;
      this.activeProfileLoaded = true;
      return;
    }

    try {
      const content = await readFile(metaPath, "utf8");
      const parsed = JSON.parse(content) as { active?: unknown };
      if (typeof parsed.active === "string") {
        this.activeProfileName = normalizeRuntimeProfileName(parsed.active);
        this.activeProfileLoaded = true;
        return;
      }
    } catch {
      // fall back to default
    }

    this.activeProfileName = RUNTIME_DEFAULT_PROFILE_NAME;
    this.activeProfileLoaded = true;
  }

  private async persistActiveProfileName(): Promise<void> {
    await mkdir(this.options.configDir, { recursive: true });
    await writeFile(
      this.getActiveProfileMetaPath(),
      JSON.stringify({ active: this.activeProfileName }, null, 2),
      "utf8",
    );
  }

  private async readConfigurationFile(filePath: string): Promise<Configuration> {
    const content = await readFile(filePath, "utf8");
    return parseRuntimeConfigurationContent(content, inferConfigurationFileFormat(filePath));
  }

  private async readProfileConfiguration(filePath: string, profileName: string): Promise<Configuration> {
    if (!existsSync(filePath)) {
      throw new Error(`Profile "${profileName}" not found`);
    }
    return await this.readConfigurationFile(filePath);
  }
}
