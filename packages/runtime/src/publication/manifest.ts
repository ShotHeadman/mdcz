import { type RootFileRef, rootFileRefSchema, wireRelativePathSchema } from "@mdcz/shared/mediaRef";
import { z } from "zod";
import type { PublicationJournalManifest } from "./types";

const wireRelativePath = wireRelativePathSchema;

const publicationObsoleteObservationSchema = z.union([
  z.object({ exists: z.literal(false) }).strict(),
  z
    .object({
      exists: z.literal(true),
      size: z.number(),
      mtimeMs: z.number(),
      isFile: z.boolean(),
    })
    .strict(),
]);

const publicationJournalManifestEntrySchema = rootFileRefSchema
  .extend({
    staged: z.object({ size: z.number(), mtimeMs: z.number(), ino: z.number(), dev: z.number() }).strict().optional(),
    temporaryPath: wireRelativePath,
    backupPath: z.union([wireRelativePath, z.null()]),
    targetExisted: z.boolean(),
    source: rootFileRefSchema.optional(),
  })
  .strict();

const publicationJournalManifestObsoleteSchema = rootFileRefSchema
  .extend({
    observed: publicationObsoleteObservationSchema,
  })
  .strict();

const boundaryLocationSchema = z.object({ path: z.string(), realPath: z.string() }).strict();
const publicationBoundarySchema = z
  .object({
    writeRoots: z.array(boundaryLocationSchema),
    writablePaths: z.array(boundaryLocationSchema),
    readOnlyPaths: z.array(boundaryLocationSchema),
    readOnlyDirectories: z.array(boundaryLocationSchema),
  })
  .strict();

const publicationJournalManifestSchema = z
  .object({
    boundary: publicationBoundarySchema.optional(),
    entries: z.array(publicationJournalManifestEntrySchema),
    obsolete: z.array(publicationJournalManifestObsoleteSchema),
  })
  .strict();

export const parsePublicationJournalManifest = (value: unknown): PublicationJournalManifest => {
  const parsed = publicationJournalManifestSchema.safeParse(value);
  if (!parsed.success) throw new Error("Publication journal manifest is invalid");
  return parsed.data;
};

export const manifestRefs = (manifest: PublicationJournalManifest): RootFileRef[] => [
  ...manifest.entries,
  ...manifest.entries.flatMap((entry) => (entry.source ? [entry.source] : [])),
  ...manifest.obsolete,
];
