export const LIBRARY_SORT_FIELDS = ["createdAt", "number", "title"] as const;
export type LibrarySortField = (typeof LIBRARY_SORT_FIELDS)[number];

export const LIBRARY_SORT_ORDERS = ["asc", "desc"] as const;
export type LibrarySortOrder = (typeof LIBRARY_SORT_ORDERS)[number];

export interface LibrarySort {
  sortBy: LibrarySortField;
  sortOrder: LibrarySortOrder;
}

export const DEFAULT_LIBRARY_SORT: LibrarySort = {
  sortBy: "createdAt",
  sortOrder: "desc",
};

export type LibraryPageCursor =
  | { sortBy: "createdAt"; sortOrder: LibrarySortOrder; createdAt: Date; id: string }
  | { sortBy: "number" | "title"; sortOrder: LibrarySortOrder; value: string; id: string };

const toBase64Url = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
};

const fromBase64Url = (encoded: string): string => {
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) throw new Error("Invalid library page cursor");
  const padded = `${encoded}${"=".repeat((4 - (encoded.length % 4)) % 4)}`.replace(/-/gu, "+").replace(/_/gu, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
};

export const encodeLibraryPageCursor = (cursor: LibraryPageCursor): string => {
  const payload =
    cursor.sortBy === "createdAt"
      ? { b: cursor.sortBy, o: cursor.sortOrder, v: cursor.createdAt.getTime(), i: cursor.id }
      : { b: cursor.sortBy, o: cursor.sortOrder, v: cursor.value, i: cursor.id };
  return toBase64Url(JSON.stringify(payload));
};

export const decodeLibraryPageCursor = (value: string | null | undefined): LibraryPageCursor | undefined => {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(normalized));
  } catch {
    throw new Error("Invalid library page cursor");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid library page cursor");
  }
  const { b, o, v, i } = parsed as Record<string, unknown>;
  if (
    typeof i !== "string" ||
    !i ||
    (o !== "asc" && o !== "desc") ||
    (b !== "createdAt" && b !== "number" && b !== "title")
  ) {
    throw new Error("Invalid library page cursor");
  }
  if (b === "createdAt") {
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) {
      throw new Error("Invalid library page cursor");
    }
    return { sortBy: b, sortOrder: o, createdAt: new Date(v), id: i };
  }
  if (typeof v !== "string") {
    throw new Error("Invalid library page cursor");
  }
  return { sortBy: b, sortOrder: o, value: v, id: i };
};
