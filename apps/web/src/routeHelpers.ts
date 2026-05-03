export const buildHref = (to: string, search?: Record<string, string | undefined>) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search ?? {})) {
    if (value !== undefined) {
      query.set(key, value);
    }
  }
  return query.size > 0 ? `${to}?${query.toString()}` : to;
};

export const normalizeSearchText = (value: string): string => value.trim().toLowerCase();

export const includesSearch = (query: string, values: readonly string[]): boolean =>
  !query || values.some((value) => value.toLowerCase().includes(query));
