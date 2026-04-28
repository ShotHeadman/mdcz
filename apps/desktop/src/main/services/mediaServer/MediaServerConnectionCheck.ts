import { toErrorMessage } from "@main/utils/common";
import type { ConnectionCheckStatus, ConnectionServerInfo } from "@mdcz/shared/ipcTypes";
import { getHttpStatus } from "./MediaServerError";

type CoreConnectionCheckKey = "server" | "auth" | "peopleRead" | "peopleWrite";

export interface ConnectionCheckStepLike<TKey extends string> {
  key: CoreConnectionCheckKey | TKey;
  label: string;
  status: ConnectionCheckStatus;
  message: string;
  code?: string;
}

export interface MediaServerConnectionCheckOutcome<TStep> {
  success: boolean;
  steps: TStep[];
  serverInfo?: ConnectionServerInfo;
  personCount?: number;
}

interface RunMediaServerConnectionCheckOptions<TExtraKey extends string, TStep, TPerson> {
  serviceName: string;
  createStep: (
    key: CoreConnectionCheckKey | TExtraKey,
    status: ConnectionCheckStatus,
    message: string,
    code?: string,
  ) => TStep;
  unreachableCode: string;
  authFailedCode: string;
  fetchPublicServerInfo: () => Promise<ConnectionServerInfo>;
  verifyAuth: () => Promise<void>;
  fetchPersons: () => Promise<ReadonlyArray<TPerson>>;
  getPersonId: (person: TPerson) => string;
  verifyWritePermission: (personId: string) => Promise<void>;
  emptyLibraryWriteMessage: string;
  extraSteps?: {
    afterServerUnreachable?: TStep[];
    afterAuthFailure?: (skippedReason: string) => TStep[];
    afterEmptyLibrary?: TStep[];
    afterWriteSuccess?: TStep[];
    afterPeopleFailure?: TStep[];
  };
}

const formatConnectedMessage = (serviceName: string, serverInfo: ConnectionServerInfo): string => {
  return serverInfo.serverName || serverInfo.version
    ? `已连接 ${[serverInfo.serverName, serverInfo.version].filter(Boolean).join(" ")}`
    : `${serviceName} 服务可达`;
};

const getErrorCode = (error: unknown): string | undefined => {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
};

export const createConnectionStepFactory = <TExtraKey extends string, TStep extends ConnectionCheckStepLike<TExtraKey>>(
  labels: Record<CoreConnectionCheckKey | TExtraKey, string>,
): ((
  key: CoreConnectionCheckKey | TExtraKey,
  status: ConnectionCheckStatus,
  message: string,
  code?: string,
) => TStep) => {
  return (key, status, message, code) =>
    ({
      key,
      label: labels[key],
      status,
      message,
      code,
    }) as TStep;
};

export const runMediaServerConnectionCheck = async <TExtraKey extends string, TStep, TPerson>(
  options: RunMediaServerConnectionCheckOptions<TExtraKey, TStep, TPerson>,
): Promise<MediaServerConnectionCheckOutcome<TStep>> => {
  const steps: TStep[] = [];
  let serverInfo: ConnectionServerInfo | undefined;
  let personCount = 0;
  let peopleReadConfirmed = false;

  try {
    serverInfo = await options.fetchPublicServerInfo();
    steps.push(options.createStep("server", "ok", formatConnectedMessage(options.serviceName, serverInfo)));
  } catch (error) {
    const message = toErrorMessage(error);
    steps.push(
      options.createStep(
        "server",
        "error",
        `无法访问 ${options.serviceName} 服务: ${message}`,
        options.unreachableCode,
      ),
    );
    steps.push(options.createStep("auth", "skipped", "未执行：服务不可达"));
    steps.push(options.createStep("peopleRead", "skipped", "未执行：服务不可达"));
    steps.push(options.createStep("peopleWrite", "skipped", "未执行：服务不可达"));
    steps.push(...(options.extraSteps?.afterServerUnreachable ?? []));
    return { success: false, steps };
  }

  try {
    await options.verifyAuth();
    steps.push(options.createStep("auth", "ok", `${options.serviceName} API Key 校验通过`));
  } catch (error) {
    const status = getHttpStatus(error);
    const message = toErrorMessage(error);
    const isAuthFailure = status === 401 || status === 403;
    const skippedReason = isAuthFailure ? "未执行：凭据无效" : "未执行：凭据校验未完成";
    const errorMessage = isAuthFailure
      ? `${options.serviceName} 凭据校验失败: ${message}`
      : `校验 ${options.serviceName} 凭据时服务异常: ${message}`;
    steps.push(
      options.createStep(
        "auth",
        "error",
        errorMessage,
        isAuthFailure ? options.authFailedCode : options.unreachableCode,
      ),
    );
    steps.push(options.createStep("peopleRead", "skipped", skippedReason));
    steps.push(options.createStep("peopleWrite", "skipped", skippedReason));
    steps.push(...(options.extraSteps?.afterAuthFailure?.(skippedReason) ?? []));
    return { success: false, steps, serverInfo };
  }

  try {
    const persons = await options.fetchPersons();
    personCount = persons.length;
    steps.push(
      options.createStep(
        "peopleRead",
        "ok",
        personCount > 0 ? "已确认人物读取权限" : `已确认人物读取权限。当前 ${options.serviceName} 人物库为空。`,
      ),
    );
    peopleReadConfirmed = true;

    if (personCount === 0) {
      steps.push(options.createStep("peopleWrite", "skipped", options.emptyLibraryWriteMessage));
      steps.push(...(options.extraSteps?.afterEmptyLibrary ?? []));
      return { success: true, steps, serverInfo, personCount };
    }

    await options.verifyWritePermission(options.getPersonId(persons[0]));
    steps.push(options.createStep("peopleWrite", "ok", "已确认人物写入权限"));
    steps.push(...(options.extraSteps?.afterWriteSuccess ?? []));
  } catch (error) {
    const key: CoreConnectionCheckKey = peopleReadConfirmed ? "peopleWrite" : "peopleRead";
    const message = toErrorMessage(error);
    steps.push(options.createStep(key, "error", message, getErrorCode(error)));
    if (key === "peopleRead") {
      steps.push(options.createStep("peopleWrite", "skipped", "未执行：人物读取失败"));
    }
    steps.push(...(options.extraSteps?.afterPeopleFailure ?? []));
    return { success: false, steps, serverInfo, personCount };
  }

  return {
    success: true,
    steps,
    serverInfo,
    personCount,
  };
};
