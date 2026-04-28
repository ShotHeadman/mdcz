import { normalize, sep } from "node:path";

const ILLEGAL_SEGMENT_CHARS = /[<>:"/\\|?*]/gu;
const REPLACED_WHITESPACE = /\s+/gu;
const TEMPLATE_EDGE_SEPARATORS = /^[\s._-]+|[\s._-]+$/gu;
const TEMPLATE_PLACEHOLDER = /\{([^{}]+)\}/gu;
const OPTIONAL_GROUP = /\[([^[\]]*)\]/gu;

export interface TemplateData {
  title?: string;
  originaltitle?: string;
  number?: string;
  actor?: string;
  actorFallbackPrefix?: string;
  date?: string;
  studio?: string;
  publisher?: string;
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
  return template.replace(TEMPLATE_PLACEHOLDER, (_match, key: string) => {
    const value = data[key];
    if (value === undefined || value === null) {
      return "";
    }
    return String(value);
  });
};

const renderTemplateValue = (
  template: string,
  data: TemplateData,
  transformValue?: (value: string) => string,
): string => {
  return template.replace(TEMPLATE_PLACEHOLDER, (_match, key: string) => {
    const value = data[key];
    if (value === undefined || value === null) {
      return "";
    }

    const stringValue = String(value);
    return transformValue ? transformValue(stringValue) : stringValue;
  });
};

const hasRenderablePlaceholderValue = (
  template: string,
  data: TemplateData,
  transformValue: (value: string) => string,
): { hasPlaceholder: boolean; hasValue: boolean } => {
  let hasPlaceholder = false;
  let hasValue = false;

  for (const match of template.matchAll(TEMPLATE_PLACEHOLDER)) {
    hasPlaceholder = true;
    const value = data[match[1] ?? ""];
    if (value === undefined || value === null) {
      continue;
    }

    if (transformValue(String(value)).length > 0) {
      hasValue = true;
      break;
    }
  }

  return { hasPlaceholder, hasValue };
};

const sanitizeTemplateValue = (value: string): string => sanitizePathSegment(value);

const trimTemplateEdges = (value: string): string => value.replace(TEMPLATE_EDGE_SEPARATORS, "");

const renderSafeSegment = (template: string, data: TemplateData): string => {
  const resolvedOptionalGroups = template.replace(OPTIONAL_GROUP, (match, inner: string) => {
    const state = hasRenderablePlaceholderValue(inner, data, sanitizeTemplateValue);
    if (!state.hasPlaceholder) {
      return match;
    }

    if (!state.hasValue) {
      return "";
    }

    const content = trimTemplateEdges(renderTemplateValue(inner, data, sanitizeTemplateValue));
    if (!content) {
      return "";
    }

    return `[${content}]`;
  });

  return renderTemplateValue(resolvedOptionalGroups, data, sanitizeTemplateValue);
};

const splitTemplateSegments = (template: string): string[] => {
  const segments: string[] = [];
  let current = "";
  let optionalDepth = 0;

  for (const char of template) {
    if (char === "[") {
      optionalDepth += 1;
      current += char;
      continue;
    }

    if (char === "]" && optionalDepth > 0) {
      optionalDepth -= 1;
      current += char;
      continue;
    }

    if ((char === "/" || char === "\\") && optionalDepth === 0) {
      segments.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  segments.push(current);
  return segments;
};

export const buildSafePath = (template: string, data: TemplateData): string => {
  return splitTemplateSegments(template)
    .map((segment) => sanitizePathSegment(trimTemplateEdges(renderSafeSegment(segment, data))))
    .filter((segment) => segment.length > 0)
    .join(sep);
};

export const buildSafeFileName = (template: string, data: TemplateData): string => {
  return sanitizePathSegment(trimTemplateEdges(renderSafeSegment(template, data)));
};

export const normalizeCrossPlatformPath = (inputPath: string): string => {
  const normalized = normalize(inputPath);
  return normalized.replace(/[\\/]+/gu, sep);
};
