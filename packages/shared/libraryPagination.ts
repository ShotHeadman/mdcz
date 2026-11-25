import { z } from "zod";

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

const libraryPageCursorSchema = z.union([
  z.object({
    sortBy: z.literal("createdAt"),
    sortOrder: z.enum(LIBRARY_SORT_ORDERS),
    createdAt: z.number().int().nonnegative(),
    id: z.string().min(1),
  }),
  z.object({
    sortBy: z.enum(["number", "title"]),
    sortOrder: z.enum(LIBRARY_SORT_ORDERS),
    value: z.string(),
    id: z.string().min(1),
  }),
]);

/** Where the next page starts: the sort key and id of the last movie on this one. */
export type LibraryPageCursor = z.infer<typeof libraryPageCursorSchema>;

/** The cursor stays opaque to clients, which only hand back what the last page gave them. */
export const encodeLibraryPageCursor = (cursor: LibraryPageCursor): string => JSON.stringify(cursor);

export const decodeLibraryPageCursor = (value: string | null | undefined): LibraryPageCursor | undefined => {
  if (!value?.trim()) return undefined;
  try {
    return libraryPageCursorSchema.parse(JSON.parse(value));
  } catch (error) {
    throw new Error("Invalid library page cursor", { cause: error });
  }
};
