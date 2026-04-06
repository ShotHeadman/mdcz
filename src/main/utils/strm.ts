import { readFile, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//iu;
const STRM_PROPERTY_PATTERN = /^#KODIPROP:/iu;
const DESKTOP_UNSUPPORTED_STRM_PROTOCOLS = new Set(["library:", "plugin:", "special:"]);

export type StrmTargetKind = "url" | "absolute_path" | "relative_path";

export interface StrmTargetInfo {
  target: string;
  kind: StrmTargetKind;
  resolvedPath?: string;
}

export const isStrmFile = (filePath: string): boolean => extname(filePath).toLowerCase() === ".strm";

const parseStrmContent = (
  content: string,
): {
  lines: string[];
  eol: "\n" | "\r\n";
  hasBom: boolean;
} => {
  const hasBom = content.startsWith("\uFEFF");
  const normalized = hasBom ? content.slice(1) : content;

  return {
    lines: normalized.length > 0 ? normalized.split(/\r?\n/u) : [],
    eol: normalized.includes("\r\n") ? "\r\n" : "\n",
    hasBom,
  };
};

const findTargetLineIndex = (lines: string[]): number | undefined => {
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || STRM_PROPERTY_PATTERN.test(trimmed)) {
      continue;
    }

    return index;
  }

  return undefined;
};

const normalizeStrmContent = (content: string): string | undefined => {
  const { lines } = parseStrmContent(content);
  const targetLineIndex = findTargetLineIndex(lines);
  if (targetLineIndex === undefined) {
    return undefined;
  }

  return lines[targetLineIndex]?.trim();
};

const isAbsoluteLocalPath = (value: string): boolean => isAbsolute(value) || win32.isAbsolute(value);

export const classifyStrmTarget = (filePath: string, target: string): StrmTargetInfo => {
  const normalized = target.trim();

  if (URI_SCHEME_PATTERN.test(normalized)) {
    try {
      const parsed = new URL(normalized);
      if (parsed.protocol === "file:") {
        const resolvedPath = fileURLToPath(parsed);
        return {
          target: normalized,
          kind: "absolute_path",
          resolvedPath,
        };
      }
    } catch {
      return {
        target: normalized,
        kind: "url",
      };
    }

    return {
      target: normalized,
      kind: "url",
    };
  }

  if (isAbsoluteLocalPath(normalized)) {
    return {
      target: normalized,
      kind: "absolute_path",
      resolvedPath: normalized,
    };
  }

  return {
    target: normalized,
    kind: "relative_path",
    resolvedPath: resolve(dirname(filePath), normalized),
  };
};

export const readStrmTarget = async (filePath: string): Promise<string | undefined> => {
  if (!isStrmFile(filePath)) {
    return undefined;
  }

  const content = await readFile(filePath, "utf8");
  return normalizeStrmContent(content);
};

export const inspectStrmTarget = async (filePath: string): Promise<StrmTargetInfo | undefined> => {
  const target = await readStrmTarget(filePath);
  return target ? classifyStrmTarget(filePath, target) : undefined;
};

export const writeStrmTarget = async (filePath: string, nextTarget: string): Promise<void> => {
  if (!isStrmFile(filePath)) {
    return;
  }

  const content = await readFile(filePath, "utf8");
  const { lines, eol, hasBom } = parseStrmContent(content);
  const targetLineIndex = findTargetLineIndex(lines);

  if (targetLineIndex === undefined) {
    lines.push(nextTarget);
  } else {
    const line = lines[targetLineIndex] ?? "";
    const leading = line.match(/^\s*/u)?.[0] ?? "";
    const trailing = line.match(/\s*$/u)?.[0] ?? "";
    lines[targetLineIndex] = `${leading}${nextTarget}${trailing}`;
  }

  await writeFile(filePath, `${hasBom ? "\uFEFF" : ""}${lines.join(eol)}`, "utf8");
};

export const resolvePlayableMediaTarget = async (
  filePath: string,
): Promise<
  | {
      kind: "path";
      target: string;
    }
  | {
      kind: "url";
      target: string;
    }
> => {
  if (!isStrmFile(filePath)) {
    return {
      kind: "path",
      target: filePath,
    };
  }

  const strmTarget = await inspectStrmTarget(filePath);
  if (!strmTarget) {
    throw new Error(`STRM file does not contain a playable target: ${filePath}`);
  }

  if (strmTarget.kind === "url") {
    const protocol = new URL(strmTarget.target).protocol.toLowerCase();
    if (DESKTOP_UNSUPPORTED_STRM_PROTOCOLS.has(protocol)) {
      throw new Error(`Desktop playback does not support STRM target protocol: ${protocol}//`);
    }

    return {
      kind: "url",
      target: strmTarget.target,
    };
  }

  return {
    kind: "path",
    target: strmTarget.resolvedPath ?? strmTarget.target,
  };
};
