import { extname } from "node:path";
import { type Configuration, configurationSchema } from "./config";

export type ConfigurationFileFormat = "json" | "toml";

export const DEFAULT_CONFIGURATION_FILE_FORMAT: ConfigurationFileFormat = "toml";
export const CONFIGURATION_FILE_EXTENSIONS: Record<ConfigurationFileFormat, string> = {
  json: ".json",
  toml: ".toml",
};

export const inferConfigurationFileFormat = (filePath: string): ConfigurationFileFormat => {
  const extension = extname(filePath).toLowerCase();
  return extension === CONFIGURATION_FILE_EXTENSIONS.json ? "json" : "toml";
};

export const serializeConfiguration = (
  configuration: Configuration,
  format: ConfigurationFileFormat = DEFAULT_CONFIGURATION_FILE_FORMAT,
): string => {
  const parsed = configurationSchema.parse(configuration);
  return format === "json" ? `${JSON.stringify(parsed, null, 2)}\n` : serializeTomlDocument(parsed);
};

export const parseConfigurationContent = (
  content: string,
  format: ConfigurationFileFormat = DEFAULT_CONFIGURATION_FILE_FORMAT,
): Configuration => {
  const raw = format === "json" ? JSON.parse(content) : parseTomlDocument(content);
  return configurationSchema.parse(raw);
};

export const readConfigurationText = (content: string, filePath: string): Configuration =>
  parseConfigurationContent(content, inferConfigurationFileFormat(filePath));

type TomlPrimitive = string | number | boolean;
type TomlValue = TomlPrimitive | TomlPrimitive[];
interface TomlObject {
  [key: string]: TomlValue | TomlObject;
}

const serializeTomlDocument = (configuration: Configuration): string => {
  const lines: string[] = [];
  serializeTomlSections(configuration as unknown as TomlObject, [], lines);
  return lines.join("\n");
};

const serializeTomlSections = (object: TomlObject, path: string[], lines: string[]): void => {
  const values: Array<[string, TomlValue]> = [];
  const children: Array<[string, TomlObject]> = [];

  for (const [key, value] of Object.entries(object)) {
    if (isTomlObject(value)) {
      children.push([key, value]);
    } else {
      values.push([key, value]);
    }
  }

  if (path.length > 0 && values.length > 0) {
    lines.push(`[${path.join(".")}]`);
    for (const [key, value] of values) {
      lines.push(`${key} = ${serializeTomlValue(value)}`);
    }
    lines.push("");
  }

  for (const [key, child] of children) {
    serializeTomlSections(child, [...path, key], lines);
  }
};

const serializeTomlValue = (value: TomlValue): string => {
  if (Array.isArray(value)) {
    return `[${value.map(serializeTomlValue).join(", ")}]`;
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  return String(value);
};

const parseTomlDocument = (content: string): TomlObject => {
  const result: TomlObject = {};
  let currentSection: TomlObject = result;

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) {
      continue;
    }

    const sectionMatch = /^\[([A-Za-z0-9_.-]+)\]$/u.exec(line);
    if (sectionMatch) {
      currentSection = getOrCreateTomlSection(result, sectionMatch[1]);
      continue;
    }

    const assignmentMatch = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/u.exec(line);
    if (!assignmentMatch) {
      throw new Error(`Invalid TOML line: ${rawLine}`);
    }

    currentSection[assignmentMatch[1]] = parseTomlValue(assignmentMatch[2].trim());
  }

  return result;
};

const stripTomlComment = (line: string): string => {
  let inString = false;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (char === "#" && !inString) {
      return line.slice(0, index);
    }
  }

  return line;
};

const getOrCreateTomlSection = (root: TomlObject, path: string): TomlObject => {
  let current = root;

  for (const sectionName of path.split(".")) {
    const section = current[sectionName];
    if (section && !isTomlObject(section)) {
      throw new Error(`Invalid TOML section: ${path}`);
    }

    if (!section) {
      const next: TomlObject = {};
      current[sectionName] = next;
      current = next;
      continue;
    }

    current = section as TomlObject;
  }

  return current;
};

const parseTomlValue = (value: string): TomlValue => {
  if (value.startsWith('"')) {
    return JSON.parse(value) as string;
  }

  if (value.startsWith("[")) {
    return parseTomlArray(value);
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (/^-?\d+(?:\.\d+)?$/u.test(value)) {
    return Number(value);
  }

  throw new Error(`Unsupported TOML value: ${value}`);
};

const parseTomlArray = (value: string): TomlPrimitive[] => {
  if (!value.endsWith("]")) {
    throw new Error(`Invalid TOML array: ${value}`);
  }

  const body = value.slice(1, -1).trim();
  if (!body) {
    return [];
  }

  return splitTomlArrayItems(body).map((item) => {
    const parsed = parseTomlValue(item.trim());
    if (Array.isArray(parsed)) {
      throw new Error(`Nested TOML arrays are not supported: ${value}`);
    }
    return parsed;
  });
};

const splitTomlArrayItems = (body: string): string[] => {
  const items: string[] = [];
  let start = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (char === "," && !inString) {
      items.push(body.slice(start, index));
      start = index + 1;
    }
  }

  items.push(body.slice(start));
  return items;
};

const isTomlObject = (value: TomlValue | TomlObject): value is TomlObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);
