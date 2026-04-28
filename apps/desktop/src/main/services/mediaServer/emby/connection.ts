import type { Configuration } from "@main/services/config";
import {
  createConnectionStepFactory,
  runMediaServerConnectionCheck,
} from "@main/services/mediaServer/MediaServerConnectionCheck";
import type { NetworkClient } from "@main/services/network";
import type { EmbyCheckKey, EmbyCheckStep, EmbyConnectionCheckResult } from "@mdcz/shared/ipcTypes";
import {
  buildEmbyHeaders,
  buildEmbyUrl,
  createEmbyConnectionExtraSteps,
  fetchMetadataEditorInfo,
  fetchPersons,
  resolveEmbyUserId,
} from "./common";

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

const createStep = createConnectionStepFactory<"adminKey", EmbyCheckStep>(STEP_LABELS);

export const checkConnection = async (
  networkClient: NetworkClient,
  configuration: Configuration,
): Promise<EmbyConnectionCheckResult> => {
  let resolvedUserId: string | undefined;
  const getResolvedUserId = async (): Promise<string> => {
    if (!resolvedUserId) {
      resolvedUserId = await resolveEmbyUserId(networkClient, configuration);
    }
    return resolvedUserId;
  };

  return await runMediaServerConnectionCheck({
    serviceName: "Emby",
    createStep,
    unreachableCode: "EMBY_UNREACHABLE",
    authFailedCode: "EMBY_AUTH_FAILED",
    fetchPublicServerInfo: async () => {
      const info = await networkClient.getJson<PublicSystemInfo>(buildEmbyUrl(configuration, "/System/Info/Public"), {
        headers: {
          accept: "application/json",
        },
      });
      return {
        serverName: typeof info.ServerName === "string" ? info.ServerName : undefined,
        version: typeof info.Version === "string" ? info.Version : undefined,
      };
    },
    verifyAuth: async () => {
      await networkClient.getJson<Record<string, unknown>>(buildEmbyUrl(configuration, "/System/Endpoint"), {
        headers: buildEmbyHeaders(configuration, {
          accept: "application/json",
        }),
      });
    },
    fetchPersons: async () =>
      await fetchPersons(networkClient, configuration, {
        limit: 1,
        fields: ["Overview"],
        userId: await getResolvedUserId(),
      }),
    getPersonId: (person) => person.Id,
    verifyWritePermission: async (personId) => {
      await fetchMetadataEditorInfo(networkClient, configuration, personId);
    },
    emptyLibraryWriteMessage: "当前 Emby 人物库为空，暂时无法在不写入数据的前提下校验人物写入权限。",
    extraSteps: createEmbyConnectionExtraSteps(createStep),
  });
};
