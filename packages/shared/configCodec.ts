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

/** Writes a document as it is, without the schema's normalization, which would drop keys this version no longer reads. */
export const serializeConfigurationDocument = (
  document: Record<string, unknown>,
  format: ConfigurationFileFormat = DEFAULT_CONFIGURATION_FILE_FORMAT,
): string => (format === "json" ? `${JSON.stringify(document, null, 2)}\n` : `${stringify(document)}\n`);

export const serializeConfiguration = (
  configuration: Configuration,
  format: ConfigurationFileFormat = DEFAULT_CONFIGURATION_FILE_FORMAT,
): string => serializeConfigurationDocument(configurationSchema.parse(configuration), format);

/** The file's document before schema validation. */
export const parseConfigurationDocument = (
  content: string,
  format: ConfigurationFileFormat = DEFAULT_CONFIGURATION_FILE_FORMAT,
): unknown => (format === "json" ? JSON.parse(content) : parse(content));

export const parseConfigurationContent = (
  content: string,
  format: ConfigurationFileFormat = DEFAULT_CONFIGURATION_FILE_FORMAT,
): Configuration => configurationSchema.parse(parseConfigurationDocument(content, format));
