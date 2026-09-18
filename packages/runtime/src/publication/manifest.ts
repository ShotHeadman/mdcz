import { type RootFileRef, rootFileRefSchema, wireRelativePathSchema } from "@mdcz/shared/mediaRef";
import { z } from "zod";
import type { PublicationJournalManifest } from "./types";

const manifestSchema = z
  .object({
    entries: z.array(
      rootFileRefSchema
        .extend({
          source: rootFileRefSchema,
          temporaryPath: wireRelativePathSchema,
          rewritten: z.boolean().optional(),
        })
        .strict(),
    ),
  })
  .strict();

export const parsePublicationJournalManifest = (value: unknown): PublicationJournalManifest => {
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) throw new Error("Publication journal manifest is invalid");
  return parsed.data;
};

export const manifestRefs = (manifest: PublicationJournalManifest): RootFileRef[] =>
  manifest.entries.flatMap((entry) => [entry, entry.source]);
