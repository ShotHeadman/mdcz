import { normalize, sep } from "node:path";

const ILLEGAL_SEGMENT_CHARS = /[<>:"/\\|?*]/gu;
const REPLACED_WHITESPACE = /\s+/gu;
const TEMPLATE_EDGE_SEPARATORS = /^[\s._-]+|[\s._-]+$/gu;

export interface TemplateData {
  title?: string;
  number?: string;
  actor?: string;
  date?: string;
  studio?: string;
  [key: string]: string | number | undefined;
}

const stripControlCharacters = (value: string): string => {
  let output = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x20) {
      output += char;
    }
  }
  return output;
};

export const sanitizePathSegment = (input: string): string => {
  return stripControlCharacters(input)
    .normalize("NFC")
    .replace(ILLEGAL_SEGMENT_CHARS, "-")
    .replace(REPLACED_WHITESPACE, " ")
    .replace(/[.-]{2,}/gu, "-")
    .trim()
    .replace(/[ .]+$/gu, "");
};

export const renderPathTemplate = (template: string, data: TemplateData): string => {
  return template.replace(/\{([^{}]+)\}/gu, (_match, key: string) => {
    const value = data[key];
    if (value === undefined || value === null) {
      return "";
    }
    return String(value);
  });
};

export const buildSafePath = (template: string, data: TemplateData): string => {
  const rendered = renderPathTemplate(template, data);

  return rendered
    .split(/[\\/]/u)
    .map((segment) => sanitizePathSegment(segment.replace(TEMPLATE_EDGE_SEPARATORS, "")))
    .filter((segment) => segment.length > 0)
    .join(sep);
};

export const normalizeCrossPlatformPath = (inputPath: string): string => {
  const normalized = normalize(inputPath);
  return normalized.replace(/[\\/]+/gu, sep);
};
