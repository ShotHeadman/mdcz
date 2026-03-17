import type { Configuration } from "@main/services/config";
import type { NetworkClient } from "@main/services/network";
import type { EmbyCheckKey, EmbyCheckStep, EmbyConnectionCheckResult } from "@shared/ipcTypes";
import { buildEmbyHeaders, buildEmbyUrl, fetchMetadataEditorInfo, fetchPersons, getHttpStatus } from "./common";

interface PublicSystemInfo {
  ServerName?: string;
  Version?: string;
}

const STEP_LABELS: Record<EmbyCheckKey, string> = {
  server: "服务可达",
  auth: "凭据有效",
  peopleRead: "人物读取权限",
  peopleWrite: "人物写入权限",
  adminKey: "管理员 API Key 提示",
};

const createStep = (
  key: EmbyCheckKey,
  status: EmbyCheckStep["status"],
  message: string,
  code?: string,
): EmbyCheckStep => ({
  key,
  label: STEP_LABELS[key],
  status,
  message,
  code,
});

export const checkConnection = async (
  networkClient: NetworkClient,
  configuration: Configuration,
): Promise<EmbyConnectionCheckResult> => {
  const steps: EmbyCheckStep[] = [];
  let serverInfo: EmbyConnectionCheckResult["serverInfo"];
  let personCount = 0;

  try {
    const info = await networkClient.getJson<PublicSystemInfo>(buildEmbyUrl(configuration, "/System/Info/Public"), {
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
          : "Emby 服务可达",
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    steps.push(createStep("server", "error", `无法访问 Emby 服务: ${message}`, "EMBY_UNREACHABLE"));
    steps.push(createStep("auth", "skipped", "未执行：服务不可达"));
    steps.push(createStep("peopleRead", "skipped", "未执行：服务不可达"));
    steps.push(createStep("peopleWrite", "skipped", "未执行：服务不可达"));
    steps.push(createStep("adminKey", "skipped", "未执行：服务不可达"));
    return { success: false, steps };
  }

  try {
    await networkClient.getJson<Record<string, unknown>>(buildEmbyUrl(configuration, "/Users/Me"), {
      headers: buildEmbyHeaders(configuration, {
        accept: "application/json",
      }),
    });
    steps.push(createStep("auth", "ok", "Emby API Key 校验通过"));
  } catch (error) {
    const status = getHttpStatus(error);
    const message = error instanceof Error ? error.message : String(error);
    const code = status === 401 || status === 403 ? "EMBY_AUTH_FAILED" : "EMBY_UNREACHABLE";
    const errorMessage =
      status === 401 || status === 403 ? `Emby 凭据校验失败: ${message}` : `校验 Emby 凭据时服务异常: ${message}`;
    steps.push(createStep("auth", "error", errorMessage, code));
    const skippedReason = status === 401 || status === 403 ? "未执行：凭据无效" : "未执行：凭据校验未完成";
    steps.push(createStep("peopleRead", "skipped", skippedReason));
    steps.push(createStep("peopleWrite", "skipped", skippedReason));
    steps.push(createStep("adminKey", "skipped", skippedReason));
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
        personCount > 0 ? "已确认人物读取权限" : "已确认人物读取权限。当前 Emby 人物库为空。",
      ),
    );

    if (personCount === 0) {
      steps.push(
        createStep("peopleWrite", "skipped", "当前 Emby 人物库为空，暂时无法在不写入数据的前提下校验人物写入权限。"),
      );
      steps.push(
        createStep(
          "adminKey",
          "skipped",
          "人物头像上传通常需要管理员 API Key。当前 Emby 人物库为空，暂时无法结合实际结果校验。",
        ),
      );
      return { success: true, steps, serverInfo, personCount };
    }

    await fetchMetadataEditorInfo(networkClient, configuration, persons[0].Id);
    steps.push(createStep("peopleWrite", "ok", "已确认人物写入权限"));
    steps.push(
      createStep(
        "adminKey",
        "skipped",
        "人物头像上传通常需要管理员 API Key。诊断不会执行实际写入验证；如果头像同步返回 401 或 403，请改用管理员 API Key。",
      ),
    );
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
    const message = error instanceof Error ? error.message : String(error);
    const key = steps.some((step) => step.key === "peopleRead") ? "peopleWrite" : "peopleRead";
    steps.push(createStep(key, "error", message, code));
    if (key === "peopleRead") {
      steps.push(createStep("peopleWrite", "skipped", "未执行：人物读取失败"));
    }
    steps.push(createStep("adminKey", "skipped", "未执行：前置人物权限校验未完成"));
    return { success: false, steps, serverInfo, personCount };
  }

  return {
    success: true,
    steps,
    serverInfo,
    personCount,
  };
};
