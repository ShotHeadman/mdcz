import { parseWireRelativePath, type RootFileRef, rootFileRefSchema } from "@mdcz/shared/mediaRef";
import { z } from "zod";
import type { PublicationJournalManifest } from "./types";

const wireRelativePath = z.string().transform(parseWireRelativePath);

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
    temporaryPath: wireRelativePath,
    backupPath: z.union([wireRelativePath, z.null()]),
    targetExisted: z.boolean(),
  })
  .strict();

const publicationJournalManifestObsoleteSchema = rootFileRefSchema
  .extend({
    observed: publicationObsoleteObservationSchema,
  })
  .strict();

const publicationJournalManifestSchema = z
  .object({
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
  ...manifest.obsolete,
];
