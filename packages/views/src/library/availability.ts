import type { LibraryAvailabilityResponse, LibraryEntryDto } from "@mdcz/shared/serverDtos";

export const mergeLibraryAvailability = (
  entries: LibraryEntryDto[],
  responses: LibraryAvailabilityResponse[],
): LibraryEntryDto[] => {
  const availabilityById = new Map(responses.flatMap((response) => response.entries).map((entry) => [entry.id, entry]));
  return entries.map((entry) => {
    const availability = availabilityById.get(entry.id);
    if (!availability) {
      return entry;
    }
    const fileAvailability = new Map(availability.fileRefs.map((file) => [file.id, file.available]));
    return {
      ...entry,
      available: availability.available,
      fileRefs: entry.fileRefs.map((file) => ({
        ...file,
        available: fileAvailability.get(file.id) ?? file.available,
      })),
    };
  });
};

export const chunkLibraryEntryIds = (ids: string[], size = 200): string[][] => {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError("Library availability chunk size must be a positive integer");
  }
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
};
