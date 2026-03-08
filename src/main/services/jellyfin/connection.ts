import type { Configuration } from "@main/services/config";
import type { NetworkClient } from "@main/services/network";
import type { JellyfinCheckKey, JellyfinCheckStep, JellyfinConnectionCheckResult } from "@shared/ipcTypes";
import { buildJellyfinHeaders, buildJellyfinUrl } from "./auth";
import { getHttpStatus } from "./errors";
import { fetchMetadataEditorInfo, fetchPersons } from "./people";

interface PublicSystemInfo {
  ServerName?: string;
  Version?: string;
}

const STEP_LABELS: Record<JellyfinCheckKey, string> = {
  server: "服务可达",
  auth: "凭据有效",
  peopleRead: "人物读取权限",
  peopleWrite: "人物写入权限",
};

const createStep = (
  key: JellyfinCheckKey,
  status: JellyfinCheckStep["status"],
  message: string,
  code?: string,
): JellyfinCheckStep => ({
  key,
  label: STEP_LABELS[key],
  status,
  message,
  code,
});

export const checkConnection = async (
  networkClient: NetworkClient,
  configuration: Configuration,
): Promise<JellyfinConnectionCheckResult> => {
  const steps: JellyfinCheckStep[] = [];
  let serverInfo: JellyfinConnectionCheckResult["serverInfo"];
  let personCount = 0;

  try {
    const info = await networkClient.getJson<PublicSystemInfo>(buildJellyfinUrl(configuration, "/System/Info/Public"), {
      headers: {
        accept: "application/json",
      },
    });
    serverInfo = {
      serverName: typeof info.ServerName === "string" ? info.ServerName : undefined,
      version: typeof info.Version === "string" ? info.Version : undefined,
    };
    steps.push(
      createStep(
        "server",
        "ok",
        serverInfo.serverName || serverInfo.version
          ? `已连接 ${[serverInfo.serverName, serverInfo.version].filter(Boolean).join(" ")}`
          : "Jellyfin 服务可达",
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    steps.push(createStep("server", "error", `无法访问 Jellyfin 服务: ${message}`, "JELLYFIN_UNREACHABLE"));
    steps.push(createStep("auth", "skipped", "未执行：服务不可达"));
    steps.push(createStep("peopleRead", "skipped", "未执行：服务不可达"));
    steps.push(createStep("peopleWrite", "skipped", "未执行：服务不可达"));
    return { success: false, steps };
  }

  try {
    await networkClient.getJson<Record<string, unknown>>(buildJellyfinUrl(configuration, "/Users/Me"), {
      headers: buildJellyfinHeaders(configuration, {
        accept: "application/json",
      }),
    });
    steps.push(createStep("auth", "ok", "Jellyfin API Key 有效"));
  } catch (error) {
    const status = getHttpStatus(error);
    const message = error instanceof Error ? error.message : String(error);
    const code = status === 401 || status === 403 ? "JELLYFIN_AUTH_FAILED" : "JELLYFIN_UNREACHABLE";
    const errorMessage =
      status === 401 || status === 403
        ? `Jellyfin 凭据校验失败: ${message}`
        : `校验 Jellyfin 凭据时服务异常: ${message}`;
    steps.push(createStep("auth", "error", errorMessage, code));
    const skippedReason = status === 401 || status === 403 ? "未执行：凭据无效" : "未执行：凭据校验未完成";
    steps.push(createStep("peopleRead", "skipped", skippedReason));
    steps.push(createStep("peopleWrite", "skipped", skippedReason));
    return { success: false, steps, serverInfo };
  }

  try {
    const persons = await fetchPersons(networkClient, configuration, {
      limit: 1,
      fields: ["Overview"],
    });
    personCount = persons.length;
    steps.push(
      createStep(
        "peopleRead",
        "ok",
        personCount > 0 ? "已确认人物读取权限" : "人物读取权限正常，但 Jellyfin 当前人物库为空",
      ),
    );

    if (personCount === 0) {
      steps.push(createStep("peopleWrite", "skipped", "人物库为空，暂无法无损校验写权限"));
      return { success: true, steps, serverInfo, personCount };
    }

    await fetchMetadataEditorInfo(networkClient, configuration, persons[0].Id);
    steps.push(createStep("peopleWrite", "ok", "已确认人物写入权限"));
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
    const message = error instanceof Error ? error.message : String(error);
    const key = steps.some((step) => step.key === "peopleRead") ? "peopleWrite" : "peopleRead";
    steps.push(createStep(key, "error", message, code));
    if (key === "peopleRead") {
      steps.push(createStep("peopleWrite", "skipped", "未执行：人物读取失败"));
    }
    return { success: false, steps, serverInfo, personCount };
  }

  return {
    success: true,
    steps,
    serverInfo,
    personCount,
  };
};
