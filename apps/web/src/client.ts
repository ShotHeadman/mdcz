import type { TaskRealtimeEventDto, WebTaskUpdateDto } from "@mdcz/shared";
import type { Configuration } from "@mdcz/shared/config";
import type { ServerApiContract } from "@mdcz/shared/serverApi";
import { createTRPCUntypedClient, httpLink } from "@trpc/client";

const FALLBACK_API_BASE = "http://127.0.0.1:3838";
const API_BASE_KEY = "mdcz-web-api-base";
const TOKEN_KEY = "mdcz-admin-token";

export const resolveDefaultApiBase = ({
  configuredBase = import.meta.env.VITE_MDCZ_API_BASE,
  development = import.meta.env.DEV,
  location = globalThis.location,
}: {
  configuredBase?: string;
  development?: boolean;
  location?: Pick<Location, "hostname" | "origin" | "protocol">;
} = {}): string => {
  const configured = configuredBase?.trim().replace(/\/+$/u, "");
  if (configured) {
    return configured;
  }
  if (!location?.origin || location.origin === "null") {
    return FALLBACK_API_BASE;
  }
  if (development) {
    return `${location.protocol}//${location.hostname}:3838`;
  }
  return location.origin.replace(/\/+$/u, "");
};

export const getApiBase = (): string => localStorage.getItem(API_BASE_KEY) ?? resolveDefaultApiBase();

export const setApiBase = (baseUrl: string): void => {
  const trimmed = baseUrl.trim().replace(/\/+$/u, "");
  if (!trimmed) {
    localStorage.removeItem(API_BASE_KEY);
    trpcCache = null;
    return;
  }
  localStorage.setItem(API_BASE_KEY, trimmed);
  trpcCache = null;
};

export const getAdminToken = (): string | null => localStorage.getItem(TOKEN_KEY);

export const setAdminToken = (token: string | undefined): void => {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    return;
  }
  localStorage.removeItem(TOKEN_KEY);
};

const isRemoteImageUrl = (value: string): boolean => /^https?:\/\//iu.test(value.trim());

const encodePathSegments = (value: string): string =>
  value
    .split(/[\\/]+/u)
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

export const getLibraryAssetSrc = (input: {
  format?: "avif" | "source" | "webp";
  revision?: string;
  rootId?: string | null;
  path: string | null | undefined;
  width?: number;
}): string => {
  const assetPath = input.path?.trim();
  if (!assetPath) {
    return "";
  }
  if (isRemoteImageUrl(assetPath)) {
    return assetPath;
  }
  const rootId = input.rootId?.trim();
  if (!rootId) {
    return "";
  }
  const url = new URL(
    `/api/library/assets/${encodeURIComponent(rootId)}/${encodePathSegments(assetPath)}`,
    getApiBase(),
  );
  const token = getAdminToken();
  if (token) {
    url.searchParams.set("token", token);
  }
  if (input.width) {
    url.searchParams.set("w", String(input.width));
    if (input.format && input.format !== "source") {
      url.searchParams.set("format", input.format);
    }
  }
  if (input.revision) {
    url.searchParams.set("revision", input.revision);
  }
  return url.toString();
};

const getAuthorizationHeaders = (): Record<string, string> => {
  const token = getAdminToken();
  if (!token) {
    return {};
  }
  return { authorization: `Bearer ${token}` };
};

type WebTrpcClient = ReturnType<typeof createTRPCUntypedClient>;

let trpcCache: { baseUrl: string; client: WebTrpcClient } | null = null;

const getTrpc = (): WebTrpcClient => {
  const baseUrl = getApiBase();
  if (trpcCache?.baseUrl === baseUrl) {
    return trpcCache.client;
  }
  const client = createTRPCUntypedClient({
    links: [
      httpLink({
        headers: getAuthorizationHeaders,
        methodOverride: "POST",
        url: `${baseUrl}/trpc`,
      }),
    ],
  });
  trpcCache = { baseUrl, client };
  return client;
};

const trpcQuery = async <TOutput>(path: string, input?: unknown): Promise<TOutput> =>
  (await getTrpc().query(path, input)) as TOutput;

const trpcMutation = async <TOutput>(path: string, input?: unknown): Promise<TOutput> =>
  (await getTrpc().mutation(path, input)) as TOutput;

export const api: ServerApiContract = {
  auth: {
    setup: () => trpcQuery("auth.setup"),
    login: async (input) => {
      const session = await trpcMutation<Awaited<ReturnType<ServerApiContract["auth"]["login"]>>>("auth.login", input);
      setAdminToken(session.token);
      return session;
    },
    logout: async () => {
      const session = await trpcMutation<Awaited<ReturnType<ServerApiContract["auth"]["logout"]>>>("auth.logout");
      setAdminToken(undefined);
      return session;
    },
    status: () => trpcQuery("auth.status"),
  },
  app: {
    ensureWatermarkDirectory: () => trpcMutation("app.ensureWatermarkDirectory"),
  },
  browser: {
    list: (input) => trpcQuery("browser.list", input),
  },
  crawler: {
    listSites: () => trpcQuery("crawler.listSites"),
    probeSiteConnectivity: (input) => trpcMutation("crawler.probeSiteConnectivity", input),
  },
  network: {
    checkCookies: () => trpcMutation("network.checkCookies"),
  },
  translate: {
    testLlm: (input) => trpcMutation("translate.testLlm", input),
  },
  serverPaths: {
    suggest: (input) => trpcQuery("serverPaths.suggest", input),
  },
  config: {
    defaults: () => trpcQuery("config.defaults"),
    export: () => trpcQuery("config.export"),
    import: (input) => trpcMutation("config.import", input),
    read: async () => await trpcQuery<Configuration>("config.read", {}),
    previewNaming: (input) => trpcMutation("config.previewNaming", input),
    reset: (input) => trpcMutation("config.reset", input ?? {}),
    update: (input) => trpcMutation("config.update", input),
    save: (input) => trpcMutation("config.save", input),
    profiles: {
      list: () => trpcQuery("config.profiles.list"),
      create: (input) => trpcMutation("config.profiles.create", input),
      switch: (input) => trpcMutation("config.profiles.switch", input),
      delete: (input) => trpcMutation("config.profiles.delete", input),
      export: (input) => trpcMutation("config.profiles.export", input),
      import: (input) => trpcMutation("config.profiles.import", input),
    },
  },
  health: {
    read: () => trpcQuery("health.read"),
  },
  system: {
    about: () => trpcQuery("system.about"),
  },
  logs: {
    list: (input) => trpcQuery("logs.list", input),
    clearRuntime: () => trpcMutation("logs.clearRuntime"),
  },
  maintenance: {
    scanSelectedFiles: (input) => trpcQuery("maintenance.scanSelectedFiles", input),
    apply: (input) => trpcMutation("maintenance.execute", input),
    pause: (input) => trpcMutation("maintenance.pause", input),
    preview: (input) => trpcQuery("maintenance.preview", input),
    recover: () => trpcQuery("maintenance.recover"),
    resume: (input) => trpcMutation("maintenance.resume", input),
    start: (input) => trpcMutation("maintenance.start", input),
    stop: (input) => trpcMutation("maintenance.stop", input),
  },
  library: {
    availability: (input) => trpcQuery("library.availability", input),
    list: (input) => trpcQuery("library.list", input),
    search: (input) => trpcQuery("library.search", input),
    detail: (input) => trpcQuery("library.detail", input),
    refresh: (input) => trpcMutation("library.refresh", input),
    rescan: (input) => trpcMutation("library.rescan", input),
    relink: (input) => trpcMutation("library.relink", input),
    delete: (input) => trpcMutation("library.delete", input),
  },
  overview: {
    summary: () => trpcQuery("overview.summary"),
    removeRecentAcquisition: (input) => trpcMutation("overview.removeRecentAcquisition", input),
  },
  mediaRoots: {
    list: () => trpcQuery("mediaRoots.list"),
  },
  persistence: {
    status: () => trpcQuery("persistence.status"),
  },
  tools: {
    catalog: () => trpcQuery("tools.catalog"),
    execute: (input) => trpcMutation("tools.execute", input),
  },
  scans: {
    candidates: (input) => trpcQuery("scans.candidates", input),
    detail: (input) => trpcQuery("scans.detail", input),
    events: (input) => trpcQuery("scans.events", input),
    list: () => trpcQuery("scans.list"),
    retry: (input) => trpcMutation("scans.retry", input),
    start: (input) => trpcMutation("scans.start", input),
  },
  scrape: {
    startSelectedFiles: (input) => trpcMutation("scrape.startSelectedFiles", input),
    deleteFile: (input) => trpcMutation("scrape.deleteFile", input),
    listResults: (input) => trpcQuery("scrape.listResults", input),
    getRecoverableSession: () => trpcQuery("scrape.getRecoverableSession"),
    nfoRead: (input) => trpcQuery("scrape.nfoRead", input),
    nfoWrite: (input) => trpcMutation("scrape.nfoWrite", input),
    posterCropSession: (input) => trpcQuery("scrape.posterCropSession", input),
    posterCropSave: (input) => trpcMutation("scrape.posterCropSave", input),
    pause: (input) => trpcMutation("scrape.pause", input),
    result: (input) => trpcQuery("scrape.result", input),
    resume: (input) => trpcMutation("scrape.resume", input),
    retry: (input) => trpcMutation("scrape.retry", input),
    confirmUncensored: (input) => trpcMutation("scrape.confirmUncensored", input),
    resolveRecoverableSession: (input) => trpcMutation("scrape.resolveRecoverableSession", input),
    start: (input) => trpcMutation("scrape.start", input),
    stop: (input) => trpcMutation("scrape.stop", input),
  },
  tasks: {
    detail: (input) => trpcQuery("tasks.detail", input),
    events: (input) => trpcQuery("tasks.events", input),
    list: () => trpcQuery("tasks.list"),
    retry: (input) => trpcMutation("tasks.retry", input),
  },
  setup: {
    complete: async (input) => {
      const session = await trpcMutation<Awaited<ReturnType<ServerApiContract["setup"]["complete"]>>>(
        "setup.complete",
        input,
      );
      setAdminToken(session.token);
      return session;
    },
    status: () => trpcQuery("setup.status"),
  },
};

const taskEventsUrl = (): string => {
  const token = getAdminToken();
  return `${getApiBase()}/events/tasks${token ? `?token=${encodeURIComponent(token)}` : ""}`;
};

const subscribeTaskEventSource = (handlers: {
  onEvent?: (payload: TaskRealtimeEventDto) => void;
  onUpdate?: (payload: WebTaskUpdateDto) => void;
}): (() => void) => {
  const eventSource = new EventSource(taskEventsUrl());
  eventSource.addEventListener("task-update", (event) => {
    handlers.onUpdate?.(JSON.parse(event.data) as WebTaskUpdateDto);
  });
  eventSource.addEventListener("task-event", (event) => {
    handlers.onEvent?.(JSON.parse(event.data) as TaskRealtimeEventDto);
  });
  return () => eventSource.close();
};

export const subscribeTaskUpdates = (onUpdate: (payload: WebTaskUpdateDto) => void): (() => void) => {
  return subscribeTaskEventSource({ onUpdate });
};

export const subscribeTaskEvents = (onEvent: (payload: TaskRealtimeEventDto) => void): (() => void) => {
  return subscribeTaskEventSource({ onEvent });
};

export const subscribeTaskRealtime = (handlers: {
  onEvent?: (payload: TaskRealtimeEventDto) => void;
  onUpdate?: (payload: WebTaskUpdateDto) => void;
}): (() => void) => {
  return subscribeTaskEventSource(handlers);
};
