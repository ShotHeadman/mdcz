import type { ServerApiContract, ServerApiProcedure, WebTaskUpdateDto } from "@mdcz/client";

const DEFAULT_API_BASE = "http://127.0.0.1:3838";
const API_BASE_KEY = "mdcz-web-api-base";
const TOKEN_KEY = "mdcz-admin-token";

export const getApiBase = (): string => localStorage.getItem(API_BASE_KEY) ?? DEFAULT_API_BASE;

export const setApiBase = (baseUrl: string): void => {
  const trimmed = baseUrl.trim().replace(/\/+$/u, "");
  if (!trimmed) {
    localStorage.removeItem(API_BASE_KEY);
    return;
  }
  localStorage.setItem(API_BASE_KEY, trimmed);
};

export const getAdminToken = (): string | null => localStorage.getItem(TOKEN_KEY);

export const setAdminToken = (token: string | undefined): void => {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    return;
  }
  localStorage.removeItem(TOKEN_KEY);
};

const procedurePath = (procedure: ServerApiProcedure): string => procedure.replace(".", ".");

const request = async <T>(procedure: ServerApiProcedure, input?: unknown): Promise<T> => {
  const token = getAdminToken();
  const response = await fetch(`${getApiBase()}/trpc/${procedurePath(procedure)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => ({}))) as { result?: { data?: T }; error?: { message?: string } };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Request failed: ${response.status}`);
  }
  return payload.result?.data as T;
};

export const api: ServerApiContract = {
  auth: {
    login: async (input) => {
      const session = await request<Awaited<ReturnType<ServerApiContract["auth"]["login"]>>>("auth.login", input);
      setAdminToken(session.token);
      return session;
    },
    logout: async () => {
      const session = await request<Awaited<ReturnType<ServerApiContract["auth"]["logout"]>>>("auth.logout");
      setAdminToken(undefined);
      return session;
    },
    status: () => request("auth.status"),
  },
  browser: {
    list: (input) => request("browser.list", input),
  },
  config: {
    export: () => request("config.export"),
    read: () => request("config.read"),
  },
  health: {
    read: () => request("health.read"),
  },
  mediaRoots: {
    create: (input) => request("mediaRoots.create", input),
    delete: (input) => request("mediaRoots.delete", input),
    disable: (input) => request("mediaRoots.disable", input),
    enable: (input) => request("mediaRoots.enable", input),
    list: () => request("mediaRoots.list"),
    update: (input) => request("mediaRoots.update", input),
  },
  persistence: {
    status: () => request("persistence.status"),
  },
  scans: {
    events: (input) => request("scans.events", input),
    list: () => request("scans.list"),
    start: (input) => request("scans.start", input),
  },
  setup: {
    status: () => request("setup.status"),
  },
};

export const subscribeTaskUpdates = (onUpdate: (payload: WebTaskUpdateDto) => void): (() => void) => {
  const token = getAdminToken();
  const eventSource = new EventSource(
    `${getApiBase()}/events/tasks${token ? `?token=${encodeURIComponent(token)}` : ""}`,
  );
  eventSource.addEventListener("task-update", (event) => {
    onUpdate(JSON.parse(event.data) as WebTaskUpdateDto);
  });
  return () => eventSource.close();
};
