export type LibraryAvailability = "available" | "partial" | "unavailable" | "unchecked";

export const libraryAvailability = (files: readonly { available: boolean | null }[]): LibraryAvailability => {
  if (!files.length || files.some((file) => file.available === null)) return "unchecked";
  const available = files.filter((file) => file.available).length;
  if (available === files.length) return "available";
  return available ? "partial" : "unavailable";
};
