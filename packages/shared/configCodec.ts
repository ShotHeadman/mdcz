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
  "# Actor alias mapping: unifies actor name variants from different sources into a canonical name. Canonical names must be quoted; each line is an independent actor group.",
  "# New scrapes output the canonical name for actors, {actor} path, and NFO name, while retaining raw spellings as actor profile aliases for avatar and profile queries.",
  "# After modifying the active profile file, restart Desktop or Server, or reload by importing/switching profiles. Existing movies and NFOs are not automatically renamed.",
  "# Example:",
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
