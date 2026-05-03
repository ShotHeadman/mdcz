import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Configuration, configurationSchema, type DeepPartial, defaultConfiguration } from "@mdcz/shared/config";
import {
  CONFIGURATION_FILE_EXTENSIONS,
  type ConfigurationFileFormat,
  inferConfigurationFileFormat,
  parseConfigurationContent,
  serializeConfiguration,
} from "@mdcz/shared/configCodec";
import type { NamingPreviewItem } from "@mdcz/shared/types";

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

const renderNamingTemplate = (
  template: string,
  sample: { label: string; number: string; title: string; actor: string; file: string },
): string =>
  template
    .replaceAll("{number}", sample.number)
    .replaceAll("{rawNumber}", sample.number)
    .replaceAll("{title}", sample.title)
    .replaceAll("{originaltitle}", "Sample Original Title")
    .replaceAll("{actor}", sample.actor)
    .replaceAll("{firstActor}", sample.actor.split(" ")[0] ?? sample.actor)
    .replaceAll("{allActors}", sample.actor)
    .replaceAll("{filename}", sample.file.replace(/\.[^.]+$/u, ""))
    .replaceAll("{date}", "2024-01-15")
    .replaceAll("{release}", "2024-01-15")
    .replaceAll("{year}", "2024")
    .replaceAll("{studio}", "示例制片")
    .replaceAll("{publisher}", "示例发行")
    .replaceAll("{director}", "示例导演")
    .replaceAll("{series}", "示例系列")
    .replaceAll("{runtime}", "121")
    .replaceAll("{definition}", "1080P")
    .replaceAll("{resolution}", "1080P")
    .replaceAll("{cnword}", sample.label === "中文字幕" ? "-C" : "")
    .replaceAll("{subtitle}", sample.label === "中文字幕" ? "中文字幕" : "")
    .replaceAll("{4K}", sample.label === "中文字幕" ? "4K" : "")
    .replaceAll("{censorshipType}", sample.number.startsWith("FC2") ? "无码" : "有码")
    .replaceAll("{score}", "4.5")
    .replaceAll("{rating}", "4.5")
    .replaceAll("{website}", "DMM");

export const buildRuntimeNamingPreview = (
  configuration: Configuration,
  patch: DeepPartial<Configuration> = {},
): { items: NamingPreviewItem[] } => {
  const config = parseRuntimeConfiguration(mergeRuntimeConfig(configuration, patch));
  const samples = [
    { label: "普通", number: "ABC-123", title: "示例中文标题", actor: "演员A", file: "ABC-123.mp4" },
    { label: "中文字幕", number: "ABC-456", title: "中文字幕示例", actor: "演员B", file: "ABC-456-C.mp4" },
    { label: "多演员", number: "DEF-012", title: "多演员作品", actor: "演员E 演员F 等演员", file: "DEF-012.mp4" },
    { label: "演员为空", number: "FC2-123456", title: "示例中文标题", actor: "示例卖家", file: "FC2-123456.mp4" },
  ];

  return {
    items: samples.map((sample) => ({
      label: sample.label,
      folder: config.behavior.successFileMove
        ? renderNamingTemplate(config.naming.folderTemplate, sample) || "当前目录"
        : "当前目录",
      file: config.behavior.successFileRename
        ? `${renderNamingTemplate(config.naming.fileTemplate, sample) || sample.number}.mp4`
        : sample.file,
    })),
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
