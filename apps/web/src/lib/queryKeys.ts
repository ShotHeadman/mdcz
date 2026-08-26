export const queryKeys = {
  auth: {
    status: ["auth", "status"] as const,
  },
  setup: {
    status: ["setup", "status"] as const,
  },
  config: {
    all: ["config"] as const,
    current: ["config", "current"] as const,
    defaults: ["config", "defaults"] as const,
    profiles: ["config", "profiles"] as const,
  },
  overview: {
    all: ["overview"] as const,
    summary: ["overview", "summary"] as const,
  },
  library: {
    all: ["library"] as const,
    search: (query: string) => ["library", "search", query] as const,
  },
  logs: {
    all: ["logs"] as const,
    list: (taskIds: readonly string[]) => ["logs", "list", ...taskIds] as const,
  },
  mediaRoots: {
    all: ["mediaRoots"] as const,
    list: ["mediaRoots", "list"] as const,
  },
  browser: {
    all: ["browser"] as const,
    list: (rootId: string) => ["browser", "list", rootId] as const,
  },
  system: {
    about: ["system", "about"] as const,
  },
  scrape: {
    all: ["scrape"] as const,
    result: (resultId: string) => ["scrape", "result", resultId] as const,
    history: (taskId?: string) =>
      taskId ? (["scrape", "history", taskId] as const) : (["scrape", "history"] as const),
  },
};
