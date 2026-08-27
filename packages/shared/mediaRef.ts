import { z } from "zod";

export const normalizeRootRelativePath = (relativePath: string): string => {
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

export const rootFileRefSchema = z
  .object({
    rootId: z.string().trim().min(1),
    relativePath: z.string().transform(normalizeRootRelativePath),
  })
  .strict();

export type RootFileRef = z.infer<typeof rootFileRefSchema>;

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
