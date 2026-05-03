import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
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
  parseConfigurationContent,
  serializeConfiguration,
} from "@mdcz/shared/configCodec";
import type { NamingPreviewItem } from "@mdcz/shared/types";

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

export class ServerConfigValidationError extends Error {
  constructor(
    message: string,
    readonly fields: string[],
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

const CONFIG_FIELD_LABELS: Record<string, string> = {
  "download.downloadSceneImages": "下载剧照",
  "download.nfoNaming": "NFO 文件命名",
  "jellyfin.userId": "Jellyfin 用户 ID",
  "naming.assetNamingMode": "附属文件命名",
  "naming.fileTemplate": "文件名模板",
  "naming.folderTemplate": "文件夹模板",
};

const formatConfigValidationError = (fieldErrors: Record<string, string>): string => {
  const details = Object.entries(fieldErrors)
    .map(([field, message]) => `${CONFIG_FIELD_LABELS[field] ?? field}：${message}`)
    .join("；");

  return details ? `配置校验失败：${details}` : "配置校验失败";
};

const getProperty = (obj: Record<string, unknown>, propertyPath: string): unknown => {
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

const setProperty = (obj: Record<string, unknown>, propertyPath: string, value: unknown): void => {
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

const parseConfiguration = (value: unknown): Configuration => {
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
  throw new ServerConfigValidationError(
    formatConfigValidationError(fieldErrors),
    Object.keys(fieldErrors),
    fieldErrors,
  );
};

const mergeConfig = <T>(base: T, patch: DeepPartial<T>): T => {
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
    merged[key] = key in merged ? mergeConfig(merged[key], value) : value;
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

    return getProperty(configuration as unknown as Record<string, unknown>, propertyPath);
  }

  async save(configuration: Configuration): Promise<Configuration> {
    this.configuration = parseConfiguration(configuration);
    await this.persist();
    return this.configuration;
  }

  defaults(): Configuration {
    return defaultConfiguration;
  }

  async update(patch: DeepPartial<Configuration>): Promise<Configuration> {
    const current = await this.get();
    return await this.save(parseConfiguration(mergeConfig(current, patch)));
  }

  async previewNaming(patch: DeepPartial<Configuration>): Promise<{ items: NamingPreviewItem[] }> {
    const current = await this.get();
    const config = parseConfiguration(mergeConfig(current, patch));
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
  }

  async reset(propertyPath?: string): Promise<Configuration> {
    if (!propertyPath) {
      return await this.save(defaultConfiguration);
    }

    const resetDefault = getConfigurationPathDefault(propertyPath);
    if (!resetDefault.found) {
      throw new Error(`Path not found: ${propertyPath}`);
    }

    const current = JSON.parse(JSON.stringify(await this.get())) as Record<string, unknown>;
    setProperty(current, propertyPath, resetDefault.value);
    return await this.save(parseConfiguration(current));
  }

  async import(content: string): Promise<Configuration> {
    return await this.save(parseConfigurationContent(content, "toml"));
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
