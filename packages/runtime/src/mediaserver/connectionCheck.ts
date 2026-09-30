import type {
  ConnectionCheckReason,
  ConnectionServerInfo,
  MediaServerCheckKey,
  MediaServerCheckStep,
  MediaServerConnectionCheckResult,
} from "@mdcz/shared/ipcTypes";
import { toErrorMessage } from "../shared";
import { getHttpStatus } from "./errors";

interface RunMediaServerConnectionCheckOptions<TPerson> {
  /** Emby adds an admin-key notice step; photo uploads there usually need an admin key. */
  includeAdminKeyStep: boolean;
  unreachableCode: string;
  authFailedCode: string;
  fetchPublicServerInfo: () => Promise<ConnectionServerInfo>;
  verifyAuth: () => Promise<void>;
  fetchPersons: () => Promise<ReadonlyArray<TPerson>>;
  getPersonId: (person: TPerson) => string;
  verifyWritePermission: (personId: string) => Promise<void>;
}

const getErrorCode = (error: unknown): string | undefined => {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
};

export const runMediaServerConnectionCheck = async <TPerson>(
  options: RunMediaServerConnectionCheckOptions<TPerson>,
): Promise<MediaServerConnectionCheckResult> => {
  const keys: MediaServerCheckKey[] = ["server", "auth", "peopleRead", "peopleWrite"];
  if (options.includeAdminKeyStep) keys.push("adminKey");
  const steps: MediaServerCheckStep[] = [];
  let serverInfo: ConnectionServerInfo | undefined;
  let personCount: number | undefined;

  const finish = (success: boolean, reason?: ConnectionCheckReason): MediaServerConnectionCheckResult => {
    for (const key of keys) {
      if (!steps.some((step) => step.key === key)) steps.push({ key, status: "skipped", reason });
    }
    return { success, steps, serverInfo, personCount };
  };

  try {
    serverInfo = await options.fetchPublicServerInfo();
    steps.push({ key: "server", status: "ok" });
  } catch (error) {
    steps.push({ key: "server", status: "error", detail: toErrorMessage(error), code: options.unreachableCode });
    return finish(false, "service_unreachable");
  }

  try {
    await options.verifyAuth();
    steps.push({ key: "auth", status: "ok" });
  } catch (error) {
    const status = getHttpStatus(error);
    const rejected = status === 401 || status === 403;
    const reason = rejected ? "auth_rejected" : "auth_unverified";
    steps.push({
      key: "auth",
      status: "error",
      reason,
      detail: toErrorMessage(error),
      code: rejected ? options.authFailedCode : options.unreachableCode,
    });
    return finish(false, reason);
  }

  let peopleReadConfirmed = false;
  try {
    const persons = await options.fetchPersons();
    personCount = persons.length;
    peopleReadConfirmed = true;
    if (persons.length === 0) {
      steps.push({ key: "peopleRead", status: "ok", reason: "empty_library" });
      return finish(true, "empty_library");
    }
    steps.push({ key: "peopleRead", status: "ok" });
    await options.verifyWritePermission(options.getPersonId(persons[0]));
    steps.push({ key: "peopleWrite", status: "ok" });
  } catch (error) {
    steps.push({
      key: peopleReadConfirmed ? "peopleWrite" : "peopleRead",
      status: "error",
      detail: toErrorMessage(error),
      code: getErrorCode(error),
    });
    return finish(false, "people_check_failed");
  }

  return finish(true);
};
