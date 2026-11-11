import { z } from "zod";
import { normalizeActorName } from "./actorAliases";
import type { CrawlerData } from "./types";

export const LIBRARY_EDIT_FIELDS = ["studio", "publisher", "director", "series", "genres", "actors"] as const;
const scalarField = z.enum(["studio", "publisher", "director", "series"]);
const listField = z.enum(["genres", "actors"]);
const value = z.string().trim().min(1);

export const libraryEditSchema = z.discriminatedUnion("operation", [
  z.object({ field: scalarField, operation: z.literal("set"), value }),
  z.object({ field: scalarField, operation: z.literal("clear") }),
  z.object({ field: listField, operation: z.literal("add"), value }),
  z.object({ field: listField, operation: z.literal("remove"), value }),
  z.object({ field: listField, operation: z.literal("rename"), from: value, to: value }),
]);
export type LibraryEdit = z.infer<typeof libraryEditSchema>;

export const libraryEditStartInputSchema = z.object({
  ids: z
    .array(value)
    .min(1)
    .transform((ids) => [...new Set(ids)]),
  edit: libraryEditSchema,
});
export type LibraryEditStartInput = z.infer<typeof libraryEditStartInputSchema>;

export const libraryEditJobSchema = z.object({
  id: z.string(),
  edit: libraryEditSchema,
  status: z.enum(["running", "completed", "failed"]),
  current: z.number(),
  total: z.number(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  changed: z.number(),
  unchanged: z.number(),
  skipped: z.number(),
  failures: z.array(z.object({ id: z.string(), reason: z.string() })),
  error: z.string().nullable(),
});
export type LibraryEditJobDto = z.infer<typeof libraryEditJobSchema>;

/** Null means the operation leaves this movie alone. Inputs are never mutated. */
export const applyLibraryEdit = (data: CrawlerData, edit: LibraryEdit): CrawlerData | null => {
  if (edit.operation === "set" || edit.operation === "clear") {
    const next = edit.operation === "set" ? edit.value : undefined;
    if ((data[edit.field] ?? "") === (next ?? "")) return null;
    return { ...data, [edit.field]: next };
  }

  const key = edit.field === "actors" ? normalizeActorName : (name: string) => name;
  const names = data[edit.field];
  const source = key(edit.operation === "rename" ? edit.from : edit.value);
  const hasSource = names.some((name) => key(name) === source);
  if (edit.operation === "add") {
    return hasSource ? null : { ...data, [edit.field]: [...names, edit.value] };
  }
  if (!hasSource) return null;
  const destination = edit.operation === "rename" ? key(edit.to) : undefined;
  const hasDestination = names.some((name) => key(name) === destination && key(name) !== source);
  const next = names.flatMap((name) => {
    if (key(name) !== source) return [name];
    return edit.operation === "rename" && !hasDestination ? [edit.to] : [];
  });
  if (next.length === names.length && next.every((name, index) => name === names[index])) return null;
  const result = { ...data, [edit.field]: next };
  if (edit.field === "actors") {
    result.actor_profiles = data.actor_profiles?.flatMap((profile) => {
      if (key(profile.name) !== source) return [profile];
      return edit.operation === "rename" && !hasDestination ? [{ ...profile, name: edit.to }] : [];
    });
  }
  return result;
};
