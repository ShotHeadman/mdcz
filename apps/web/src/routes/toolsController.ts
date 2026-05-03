import type { EmbyConnectionCheckResult, JellyfinConnectionCheckResult } from "@mdcz/shared/ipcTypes";
import type { ToolExecuteResponse } from "@mdcz/shared/serverDtos";
import type { FileCleanerCandidateView, PersonServer, ToolRunState } from "@mdcz/views/tools";
import { type FormatBytesOptions, formatBytes as formatSharedBytes } from "../utils/format";

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

export const formatToolBytes = (bytes: number, options: Pick<FormatBytesOptions, "fractionDigits"> = {}): string =>
  formatSharedBytes(bytes, options);

export const fileCleanerCandidatesFromResponse = (response: ToolExecuteResponse): FileCleanerCandidateView[] => {
  const data = response.data as { files?: string[] } | undefined;
  return (data?.files ?? []).map((path) => ({ path }));
};

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
