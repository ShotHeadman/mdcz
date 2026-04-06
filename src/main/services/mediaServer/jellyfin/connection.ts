import type { Configuration } from "@main/services/config";
import {
  createConnectionStepFactory,
  runMediaServerConnectionCheck,
} from "@main/services/mediaServer/MediaServerConnectionCheck";
import type { NetworkClient } from "@main/services/network";
import type { JellyfinCheckKey, JellyfinCheckStep, JellyfinConnectionCheckResult } from "@shared/ipcTypes";
import { buildJellyfinHeaders, buildJellyfinUrl } from "./auth";
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

const createStep = createConnectionStepFactory<never, JellyfinCheckStep>(STEP_LABELS);

export const checkConnection = async (
  networkClient: NetworkClient,
  configuration: Configuration,
): Promise<JellyfinConnectionCheckResult> => {
  return await runMediaServerConnectionCheck({
    serviceName: "Jellyfin",
    createStep,
    unreachableCode: "JELLYFIN_UNREACHABLE",
    authFailedCode: "JELLYFIN_AUTH_FAILED",
    fetchPublicServerInfo: async () => {
      const info = await networkClient.getJson<PublicSystemInfo>(
        buildJellyfinUrl(configuration, "/System/Info/Public"),
        {
          headers: {
            accept: "application/json",
          },
        },
      );
      return {
        serverName: typeof info.ServerName === "string" ? info.ServerName : undefined,
        version: typeof info.Version === "string" ? info.Version : undefined,
      };
    },
    verifyAuth: async () => {
      await networkClient.getJson<Record<string, unknown>>(buildJellyfinUrl(configuration, "/System/Info"), {
        headers: buildJellyfinHeaders(configuration, {
          accept: "application/json",
        }),
      });
    },
    fetchPersons: async () =>
      await fetchPersons(networkClient, configuration, {
        limit: 1,
        fields: ["Overview"],
      }),
    getPersonId: (person) => person.Id,
    verifyWritePermission: async (personId) => {
      await fetchMetadataEditorInfo(networkClient, configuration, personId);
    },
    emptyLibraryWriteMessage: "当前 Jellyfin 人物库为空，暂时无法在不写入数据的前提下校验人物写入权限。",
  });
};
