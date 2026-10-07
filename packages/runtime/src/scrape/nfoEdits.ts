import { createHash } from "node:crypto";
import type { CrawlerData, NfoEditableField, NfoLocalState } from "@mdcz/shared/types";
import { normalizeNewlines } from "./translate/shared";

type Fingerprints = Partial<Record<NfoEditableField, string>>;

/** The data each editable NFO element carries, and the Emby/Jellyfin lock name for it where one exists. */
const EDITABLE_FIELDS: Readonly<Record<NfoEditableField, { lock?: string; keys: readonly (keyof CrawlerData)[] }>> = {
  title: { lock: "Name", keys: ["title", "original_title", "title_zh"] },
  originaltitle: { lock: "OriginalTitle", keys: ["title", "original_title"] },
  plot: { lock: "Overview", keys: ["plot", "plot_zh"] },
  actor: { lock: "Cast", keys: ["actors"] },
  genre: { lock: "Genres", keys: ["genres"] },
  studio: { lock: "Studios", keys: ["studio"] },
  director: { keys: ["director"] },
  publisher: { keys: ["publisher"] },
  set: { lock: "Collections", keys: ["series"] },
  premiered: { keys: ["release_date"] },
  rating: { lock: "CommunityRating", keys: ["rating"] },
};
const FIELDS = Object.keys(EDITABLE_FIELDS) as NfoEditableField[];

const nodeText = (node: unknown): string => {
  const record = node && typeof node === "object" ? (node as Record<string, unknown>) : undefined;
  // Emby writes <set><name>…</name></set> and drops actor thumbs; only names and text identify a value.
  const value = record ? (record.name ?? record["#text"]) : node;
  return typeof value === "string" || typeof value === "number" ? normalizeNewlines(String(value)).trim() : "";
};

/**
 * Hashes an element of a parsed or to-be-written `<movie>` node into letters only, because the NFO parser turns
 * numeric-looking text into numbers. Order is ignored: media servers may reorder genres and cast.
 */
export const fingerprintNfoField = (movie: Record<string, unknown>, field: NfoEditableField): string => {
  const values = (Array.isArray(movie[field]) ? movie[field] : [movie[field]])
    .map(nodeText)
    // Emby reads <genre>A/B</genre> as two genres and writes them back as separate elements.
    .flatMap((value) => (field === "genre" ? value.split("/").map((part) => part.trim()) : [value]))
    .filter(Boolean)
    .sort();
  const digest = createHash("sha256").update(JSON.stringify(values)).digest();
  return Array.from(digest.subarray(0, 10), (byte) => String.fromCharCode(97 + (byte % 26))).join("");
};

export const fingerprintNfo = (movie: Record<string, unknown>): Record<NfoEditableField, string> =>
  Object.fromEntries(FIELDS.map((field) => [field, fingerprintNfoField(movie, field)])) as Record<
    NfoEditableField,
    string
  >;

/** Current fingerprints of the fields whose values no longer match what MDCz published. */
export const detectNfoEdits = (movie: Record<string, unknown>, published: Fingerprints | undefined): Fingerprints => {
  const current = fingerprintNfo(movie);
  return Object.fromEntries(
    FIELDS.filter((field) => published?.[field] && published[field] !== current[field]).map((field) => [
      field,
      current[field],
    ]),
  );
};

/** Fingerprints a write stores: an edit it keeps stays recognizable as an edit, anything else becomes MDCz's value. */
export const publishedFingerprints = (
  movie: Record<string, unknown>,
  localState?: NfoLocalState,
): Record<NfoEditableField, string> => {
  const written = fingerprintNfo(movie);
  for (const field of FIELDS) {
    const previous = localState?.published?.[field];
    if (previous && localState?.edits?.[field] === written[field]) written[field] = previous;
  }
  return written;
};

/**
 * `<mdcz><published>` holds `field:fingerprint` pairs as one text, so no element inside `<mdcz>` shares a name with
 * the standard NFO elements a reader may search for.
 */
export const formatFingerprints = (fingerprints: Fingerprints): string =>
  Object.entries(fingerprints)
    .map(([field, fingerprint]) => `${field}:${fingerprint}`)
    .join(" ");

export const parseFingerprints = (text: unknown): Fingerprints =>
  typeof text === "string"
    ? Object.fromEntries(
        text
          .split(/\s+/u)
          .map((pair) => pair.split(":"))
          .filter((pair): pair is [NfoEditableField, string] => pair.length === 2 && pair[0] in EDITABLE_FIELDS),
      )
    : {};

/** Data keys whose values someone edited in the NFO after MDCz published it. */
export const editedKeys = (localState?: NfoLocalState): Set<keyof CrawlerData> =>
  new Set(FIELDS.filter((field) => localState?.edits?.[field]).flatMap((field) => EDITABLE_FIELDS[field].keys));

/** Data keys a media-server lock pins; MDCz never writes locks itself, so these are the user's own. */
export const lockedKeys = (localState?: NfoLocalState): Set<keyof CrawlerData> => {
  const locks = new Set(localState?.lockedFields?.map((name) => name.toLowerCase()));
  return new Set(
    Object.values(EDITABLE_FIELDS).flatMap(({ lock, keys }) => (lock && locks.has(lock.toLowerCase()) ? keys : [])),
  );
};
