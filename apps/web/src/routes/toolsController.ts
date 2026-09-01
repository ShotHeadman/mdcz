import type { EmbyConnectionCheckResult, JellyfinConnectionCheckResult } from "@mdcz/shared/ipcTypes";
import type { ToolExecuteResponse } from "@mdcz/shared/serverDtos";
import type { PersonServer, ToolRunState } from "@mdcz/views/tools";

export const toRunState = (mutation: {
  isPending: boolean;
  data?: { message?: string; data?: unknown };
  error: Error | null;
}): ToolRunState => ({
  pending: mutation.isPending,
  message: mutation.data?.message,
  data: mutation.data?.data ?? mutation.data,
  error: mutation.error?.message,
});

export const toMediaServerCheckResult = (
  server: PersonServer,
  response: ToolExecuteResponse,
): JellyfinConnectionCheckResult | EmbyConnectionCheckResult => {
  const detail = (response.data as { detail?: Record<string, unknown> } | undefined)?.detail ?? {};
  const serverName = typeof detail.serverName === "string" ? detail.serverName : undefined;
  const version = typeof detail.version === "string" ? detail.version : undefined;
  const personCount = typeof detail.personCount === "number" ? detail.personCount : undefined;
  const label = server === "jellyfin" ? "Jellyfin 连接" : "Emby 连接";
  return {
    success: response.ok,
    serverInfo: { serverName, version },
    personCount,
    steps: [
      {
        key: "server",
        label,
        status: response.ok ? "ok" : "error",
        message: response.message,
      },
    ],
  } as JellyfinConnectionCheckResult | EmbyConnectionCheckResult;
};
