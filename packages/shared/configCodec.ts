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

export const serializeConfiguration = (
  configuration: Configuration,
  format: ConfigurationFileFormat = DEFAULT_CONFIGURATION_FILE_FORMAT,
): string => {
  const parsed = configurationSchema.parse(configuration);
  return format === "json" ? `${JSON.stringify(parsed, null, 2)}\n` : `${stringify(parsed)}\n`;
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
