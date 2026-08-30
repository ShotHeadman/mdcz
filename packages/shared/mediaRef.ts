import { z } from "zod";

export const parseWireRelativePath = (relativePath: string): string => {
  const normalized = relativePath.replace(/\\/gu, "/").replace(/^\.\//u, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new Error(`Invalid media relative path: ${relativePath}`);
  }
  return normalized;
};

export const parseWireRelativeDirectory = (relativeDirectory: string): string => {
  const normalized = relativeDirectory.replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
  return normalized ? parseWireRelativePath(normalized) : "";
};

export const rootFileRefSchema = z
  .object({
    rootId: z.string().trim().min(1),
    relativePath: z.string().transform(parseWireRelativePath),
  })
  .strict();

export type RootFileRef = z.infer<typeof rootFileRefSchema>;

export const localFileTargetSchema = z.union([z.string().trim().min(1), rootFileRefSchema]);

export type LocalFileTarget = z.infer<typeof localFileTargetSchema>;

export const assetRefSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("local"),
      kind: z.string().trim().min(1),
      file: rootFileRefSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("remote"),
      kind: z.string().trim().min(1),
      url: z.string().url(),
    })
    .strict(),
]);

export type AssetRef = z.infer<typeof assetRefSchema>;

export const LOCAL_FILE_SCHEME = "local-file";

export const toLocalFileUrl = (ref: RootFileRef, query?: Record<string, string>): string => {
  const relativePath = parseWireRelativePath(ref.relativePath);
  const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
  const url = `${LOCAL_FILE_SCHEME}://${encodeURIComponent(ref.rootId)}/${encodedPath}`;
  const params = Object.entries(query ?? {}).filter(([, value]) => value.length > 0);
  if (params.length === 0) {
    return url;
  }
  return `${url}?${new URLSearchParams(params).toString()}`;
};

export const parseLocalFileUrl = (value: string): RootFileRef => {
  const separator = "://";
  const schemeEnd = value.indexOf(separator);
  if (schemeEnd < 0 || value.slice(0, schemeEnd).toLowerCase() !== LOCAL_FILE_SCHEME) {
    throw new Error(`Unsupported asset URL: ${value}`);
  }

  // Parse the path ourselves. `new URL()` collapses `..` / `%2e%2e` before we can reject them.
  const body = (value.slice(schemeEnd + separator.length).split(/[?#]/u, 1)[0] ?? "").replace(/\/+$/u, "");
  const slash = body.indexOf("/");
  if (slash <= 0) {
    throw new Error(`Unsupported asset URL: ${value}`);
  }

  return rootFileRefSchema.parse({
    rootId: decodeURIComponent(body.slice(0, slash)),
    relativePath: decodeURIComponent(body.slice(slash + 1)),
  });
};

export const isRemoteAssetUrl = (value: string): boolean => /^(?:https?:|data:|blob:)/iu.test(value.trim());
