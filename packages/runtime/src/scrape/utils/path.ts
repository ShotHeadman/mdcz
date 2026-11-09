import { sep } from "node:path";

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

const renderTemplateValue = (template: string, data: TemplateData, transformValue: (value: string) => string): string =>
  template.replace(TEMPLATE_PLACEHOLDER, (_match, key: string) => {
    const value = data[key];
    return value === undefined || value === null ? "" : transformValue(String(value));
  });

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

const trimTemplateEdges = (value: string): string => value.replace(TEMPLATE_EDGE_SEPARATORS, "");

const renderSegment = (template: string, data: TemplateData, transformValue: (value: string) => string): string => {
  const resolvedOptionalGroups = template.replace(OPTIONAL_GROUP, (match, inner: string) => {
    const state = hasRenderablePlaceholderValue(inner, data, transformValue);
    if (!state.hasPlaceholder) {
      return match;
    }

    if (!state.hasValue) {
      return "";
    }

    const content = trimTemplateEdges(renderTemplateValue(inner, data, transformValue));
    if (!content) {
      return "";
    }

    return `[${content}]`;
  });

  return renderTemplateValue(resolvedOptionalGroups, data, transformValue);
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
    .map((segment) => sanitizePathSegment(trimTemplateEdges(renderSegment(segment, data, sanitizePathSegment))))
    .filter((segment) => segment.length > 0)
    .join(sep);
};

export const buildSafeFileName = (template: string, data: TemplateData): string => {
  return sanitizePathSegment(trimTemplateEdges(renderSegment(template, data, sanitizePathSegment)));
};

/** Renders a template into free text such as an NFO title: values keep path-illegal characters like `/` and `:`. */
export const renderTextTemplate = (template: string, data: TemplateData): string =>
  renderSegment(template, data, (value) => value)
    .replace(REPLACED_WHITESPACE, " ")
    .trim();
