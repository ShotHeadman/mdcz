export const buildHref = (to: string, search?: Record<string, string | undefined>) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search ?? {})) {
    if (value !== undefined) {
      query.set(key, value);
    }
  }
  return query.size > 0 ? `${to}?${query.toString()}` : to;
};
