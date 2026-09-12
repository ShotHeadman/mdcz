import { readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, posix, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteFile } from "@mdcz/media-store";
import type { Configuration } from "@mdcz/shared/config";
import { localPathPrefixKey, localPathStyle } from "@mdcz/shared/localPath";

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
    resolvedPath: (localPathStyle(filePath) === "windows" ? win32 : posix).resolve(
      (localPathStyle(filePath) === "windows" ? win32 : posix).dirname(filePath),
      normalized,
    ),
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

  const content = await readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  });
  await atomicWriteFile(filePath, replaceStrmTarget(content, nextTarget));
};

export const replaceStrmTarget = (content: string, nextTarget: string): string => {
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

  return `${hasBom ? "\uFEFF" : ""}${lines.join(eol)}`;
};

export const prepareMovedStrmContent = async (sourcePath: string, targetPath: string): Promise<string | undefined> => {
  if (!isStrmFile(sourcePath) || resolve(dirname(sourcePath)) === resolve(dirname(targetPath))) return undefined;
  const content = await readFile(sourcePath, "utf8");
  const target = normalizeStrmContent(content);
  if (!target) return undefined;
  const info = classifyStrmTarget(sourcePath, target);
  return info.kind === "relative_path" && info.resolvedPath ? replaceStrmTarget(content, info.resolvedPath) : undefined;
};

export const mapStrmPath = (actualPath: string, mappings: Configuration["paths"]["strmPathMappings"] = []): string => {
  const style = localPathStyle(actualPath);
  const sourcePath = (style === "windows" ? win32 : posix).normalize(actualPath);
  const key = localPathPrefixKey(sourcePath);
  const matching = mappings
    .filter(({ from }) => {
      if (localPathStyle(from) !== style) return false;
      const prefix = localPathPrefixKey(from);
      return key === prefix || key.startsWith(prefix === "/" ? prefix : `${prefix}/`);
    })
    .sort((a, b) => localPathPrefixKey(b.from).length - localPathPrefixKey(a.from).length)[0];
  if (!matching) return actualPath;
  const sourceApi = style === "windows" ? win32 : posix;
  const targetApi = localPathStyle(matching.to) === "windows" ? win32 : posix;
  return targetApi.join(
    matching.to,
    ...sourceApi.relative(matching.from, sourcePath).split(sourceApi.sep).filter(Boolean),
  );
};

export const prepareStrmMirrorContent = async (
  sourcePath: string,
  outputVideoPath: string,
  mappings: Configuration["paths"]["strmPathMappings"] = [],
): Promise<string> => {
  if (!isStrmFile(sourcePath)) return mapStrmPath(resolve(outputVideoPath), mappings);
  const content = await readFile(sourcePath, "utf8");
  const targets = parseStrmContent(content).lines.filter(
    (line) => line.trim() && !STRM_PROPERTY_PATTERN.test(line.trim()),
  );
  if (
    targets.length !== 1 ||
    targets[0].trim().startsWith("#") ||
    [...content].some((character) => character.charCodeAt(0) < 32 && !["\t", "\n", "\r"].includes(character))
  ) {
    throw new Error(`STRM file must contain exactly one playable target: ${sourcePath}`);
  }
  const target = targets[0].trim();
  if (/^[a-z]:[^\\/]/iu.test(target)) throw new Error(`STRM contains a drive-relative path: ${sourcePath}`);
  if (URI_SCHEME_PATTERN.test(target)) {
    new URL(target);
    return content;
  }
  const info = classifyStrmTarget(sourcePath, target);
  if (!info.resolvedPath) throw new Error(`STRM file does not contain a playable target: ${sourcePath}`);
  const mapped = mapStrmPath(info.resolvedPath, mappings);
  return mapped === target ? content : replaceStrmTarget(content, mapped);
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
