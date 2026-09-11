import { parse, stringify } from "smol-toml";
import { type Configuration, configurationSchema } from "./config";

export type ConfigurationFileFormat = "json" | "toml";

export const DEFAULT_CONFIGURATION_FILE_FORMAT: ConfigurationFileFormat = "toml";
export const CONFIGURATION_FILE_EXTENSIONS: Record<ConfigurationFileFormat, string> = {
  json: ".json",
  toml: ".toml",
};

export const inferConfigurationFileFormat = (filePath: string): ConfigurationFileFormat => {
  const normalized = filePath.split(/[\\/]/u).at(-1) ?? filePath;
  const dotIndex = normalized.lastIndexOf(".");
  const extension = dotIndex >= 0 ? normalized.slice(dotIndex).toLowerCase() : "";
  return extension === CONFIGURATION_FILE_EXTENSIONS.json ? "json" : "toml";
};

const ACTOR_ALIASES_HEADER = "[personSync.actorAliases]";
const ACTOR_ALIASES_COMMENTS = [
  "# 演员别名映射：将不同来源的演员写法统一为一个规范名称。规范名称必须使用引号；每行是一个独立的演员组。",
  "# 新刮削会以键名输出演员、{actor} 路径和 NFO 名称，同时保留原始写法为人物资料别名，用于头像和资料查询。",
  "# 修改 active profile 文件后，请重启 Desktop 或 Server，或通过导入/切换 profile 使配置重新加载。已有影片和 NFO 不会被自动重命名。",
  "# 示例：",
  '# "河北彩花" = ["河北彩伽", "河北彩花（河北彩伽）"]',
  '# "三上悠亚" = ["鬼頭桃菜", "鬼头桃菜"]',
].join("\n");

const annotateTomlConfiguration = (toml: string, configuration: Configuration): string => {
  const target = `${ACTOR_ALIASES_HEADER}\n`;
  if (!toml.includes(target)) {
    return toml;
  }
  const isEmpty = Object.keys(configuration.personSync.actorAliases).length === 0;
  const replacement = isEmpty
    ? `${ACTOR_ALIASES_COMMENTS}\n${ACTOR_ALIASES_HEADER}\n\n`
    : `${ACTOR_ALIASES_COMMENTS}\n${ACTOR_ALIASES_HEADER}\n`;
  return toml.replace(target, replacement);
};

export const serializeConfiguration = (
  configuration: Configuration,
  format: ConfigurationFileFormat = DEFAULT_CONFIGURATION_FILE_FORMAT,
): string => {
  const parsed = configurationSchema.parse(configuration);
  return format === "json"
    ? `${JSON.stringify(parsed, null, 2)}\n`
    : `${annotateTomlConfiguration(stringify(parsed), parsed)}\n`;
};

export const parseConfigurationContent = (
  content: string,
  format: ConfigurationFileFormat = DEFAULT_CONFIGURATION_FILE_FORMAT,
): Configuration => {
  const raw = format === "json" ? JSON.parse(content) : parse(content);
  return configurationSchema.parse(raw);
};

export const readConfigurationText = (content: string, filePath: string): Configuration =>
  parseConfigurationContent(content, inferConfigurationFileFormat(filePath));
