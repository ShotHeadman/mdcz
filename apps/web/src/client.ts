import type { TaskNotificationDto } from "@mdcz/shared";
import type { Configuration } from "@mdcz/shared/config";
import { DomainErrorCode, type DomainErrorShape, type LibraryTaskConflictDomainError } from "@mdcz/shared/error";
import type { ServerApiContract } from "@mdcz/shared/serverApi";
import { getT } from "@mdcz/views/i18n";
import { createTRPCUntypedClient, httpLink, TRPCClientError } from "@trpc/client";

const FALLBACK_API_BASE = "http://127.0.0.1:3838";
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
  // The Vite dev server runs beside the API; desktop's dev page is served same-origin through the API scheme.
  if (development && location.protocol.startsWith("http")) {
    return `${location.protocol}//${location.hostname}:3838`;
  }
  return location.origin.replace(/\/+$/u, "");
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
    resolveDefaultApiBase(),
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
  const baseUrl = resolveDefaultApiBase();
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

// The server refuses in English for its logs and API callers; the page says it in the reader's language.
const localizeError = (error: unknown): unknown => {
  const domainError: DomainErrorShape | undefined =
    error instanceof TRPCClientError ? error.data?.domainError : undefined;
  if (domainError?.code !== DomainErrorCode.LIBRARY_TASK_CONFLICT) return error;
  const { running } = (domainError as LibraryTaskConflictDomainError).details;
  return new Error(getT().workbench.taskConflict[running], { cause: error });
};

const trpcQuery = async <TOutput>(path: string, input?: unknown): Promise<TOutput> => {
  try {
    return (await getTrpc().query(path, input)) as TOutput;
  } catch (error) {
    throw localizeError(error);
  }
};

const trpcMutation = async <TOutput>(path: string, input?: unknown): Promise<TOutput> => {
  try {
    return (await getTrpc().mutation(path, input)) as TOutput;
  } catch (error) {
    throw localizeError(error);
  }
};

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
    test: (input) => trpcMutation("translate.test", input),
  },
  serverPaths: {
    suggest: (input) => trpcQuery("serverPaths.suggest", input),
  },
  config: {
    defaults: () => trpcQuery("config.defaults"),
    export: () => trpcQuery("config.export"),
    import: (input) => trpcMutation("config.import", input),
    read: () => trpcQuery<Configuration>("config.read"),
    reset: (input) => trpcMutation("config.reset", input ?? {}),
    update: (input) => trpcMutation("config.update", input),
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
    execute: (input) => trpcMutation("maintenance.execute", input),
    pause: (input) => trpcMutation("maintenance.pause", input),
    getActiveSession: () => trpcQuery("maintenance.getActiveSession"),
    updateDraft: (input) => trpcMutation("maintenance.updateDraft", input),
    discardSession: (input) => trpcMutation("maintenance.discardSession", input),
    resume: (input) => trpcMutation("maintenance.resume", input),
    start: (input) => trpcMutation("maintenance.start", input),
    stop: (input) => trpcMutation("maintenance.stop", input),
  },
  activity: {
    list: (input) => trpcQuery("activity.list", input),
  },
  library: {
    removeFile: (input) => trpcMutation("library.removeFile", input),
    availability: (input) => trpcQuery("library.availability", input),
    list: (input) => trpcQuery("library.list", input),
    summary: (input) => trpcQuery("library.summary", input),
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
  libraries: {
    list: () => trpcQuery("libraries.list"),
    create: (input) => trpcMutation("libraries.create", input),
    update: (input) => trpcMutation("libraries.update", input),
    delete: (input) => trpcMutation("libraries.delete", input),
    previewNaming: (input) => trpcMutation("libraries.previewNaming", input),
    probeStubs: (input) => trpcQuery("libraries.probeStubs", input),
  },
  pending: {
    list: () => trpcQuery("pending.list"),
    detail: (input) => trpcQuery("pending.detail", input),
    retry: (input) => trpcMutation("pending.retry", input),
    confirmUncensored: (input) => trpcMutation("pending.confirmUncensored", input),
    ignore: (input) => trpcMutation("pending.ignore", input),
  },
  apiKeys: {
    list: () => trpcQuery("apiKeys.list"),
    create: (input) => trpcMutation("apiKeys.create", input),
    delete: (input) => trpcMutation("apiKeys.delete", input),
  },
  notifications: {
    test: (input) => trpcMutation("notifications.test", input),
  },
  integrations: {
    status: () => trpcQuery("integrations.status"),
  },
  mediaRoots: {
    ensurePath: (input) => trpcMutation("mediaRoots.ensurePath", input),
    list: () => trpcQuery("mediaRoots.list"),
  },
  persistence: {
    status: () => trpcQuery("persistence.status"),
  },
  tools: {
    catalog: () => trpcQuery("tools.catalog"),
    execute: (input) => trpcMutation("tools.execute", input),
    startPersonSync: (input) => trpcMutation("tools.startPersonSync", input),
    personSyncStatus: () => trpcQuery("tools.personSyncStatus"),
  },
  scans: {
    cancelCandidates: (input) => trpcMutation("scans.cancelCandidates", input),
    candidates: (input) => trpcQuery("scans.candidates", input),
    detail: (input) => trpcQuery("scans.detail", input),
    events: (input) => trpcQuery("scans.events", input),
    list: () => trpcQuery("scans.list"),
    retry: (input) => trpcMutation("scans.retry", input),
    start: (input) => trpcMutation("scans.start", input),
  },
  scrape: {
    actorSyncStatus: () => trpcQuery("scrape.actorSyncStatus"),
    cancelActorSync: (input) => trpcMutation("scrape.cancelActorSync", input),
    liveRuns: () => trpcQuery("scrape.liveRuns"),
    snapshot: (input) => trpcQuery("scrape.snapshot", input),
    removeRecord: (input) => trpcMutation("scrape.removeRecord", input),
    history: (input) => trpcQuery("scrape.history", input),
    nfoRead: (input) => trpcQuery("scrape.nfoRead", input),
    nfoWrite: (input) => trpcMutation("scrape.nfoWrite", input),
    posterCropSession: (input) => trpcQuery("scrape.posterCropSession", input),
    posterCropSave: (input) => trpcMutation("scrape.posterCropSave", input),
    pause: (input) => trpcMutation("scrape.pause", input),
    result: (input) => trpcQuery("scrape.result", input),
    resume: (input) => trpcMutation("scrape.resume", input),
    retry: (input) => trpcMutation("scrape.retry", input),
    rerunDirectory: (input) => trpcMutation("scrape.rerunDirectory", input),
    start: (input) => trpcMutation("scrape.start", input),
    stop: (input) => trpcMutation("scrape.stop", input),
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
  return `${resolveDefaultApiBase()}/events/tasks${token ? `?token=${encodeURIComponent(token)}` : ""}`;
};

export const subscribeTaskNotifications = (handlers: {
  onNotification?: (payload: TaskNotificationDto) => void;
  onError?: () => void;
  onHeartbeat?: () => void;
  onOpen?: () => void;
}): (() => void) => {
  const eventSource = new EventSource(taskEventsUrl());
  eventSource.addEventListener("open", () => {
    handlers.onOpen?.();
  });
  eventSource.addEventListener("error", () => {
    handlers.onError?.();
  });
  eventSource.addEventListener("heartbeat", () => {
    handlers.onHeartbeat?.();
  });
  eventSource.addEventListener("notification", (event) => {
    handlers.onNotification?.(JSON.parse(event.data) as TaskNotificationDto);
  });
  return () => eventSource.close();
};
