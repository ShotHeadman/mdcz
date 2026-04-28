import type { ServiceContainer } from "@main/container";
import { configManager } from "@main/services/config";
import { toErrorMessage } from "@main/utils/common";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { IpcRouterContract } from "@mdcz/shared/ipcContract";
import { t } from "../shared";

export const createNetworkHandlers = (
  context: ServiceContainer,
): Pick<IpcRouterContract, typeof IpcChannel.Network_CheckCookies> => {
  const { networkClient } = context;

  return {
    [IpcChannel.Network_CheckCookies]: t.procedure.action(async () => {
      const configuration = await configManager.getValidated();
      const results: Array<{ site: string; valid: boolean; message: string }> = [];

      const javdbCookie = configuration.network.javdbCookie.trim();
      if (javdbCookie) {
        try {
          const html = await networkClient.getText("https://javdb.com/users/profile", {
            headers: { cookie: javdbCookie },
          });
          const valid = !html.includes('href="/login"') && !html.includes("sign_in");
          results.push({ site: "JavDB", valid, message: valid ? "Cookie 有效" : "Cookie 无效或已过期" });
        } catch (error) {
          results.push({ site: "JavDB", valid: false, message: `请求失败: ${toErrorMessage(error)}` });
        }
      } else {
        results.push({ site: "JavDB", valid: false, message: "未配置 Cookie" });
      }

      const javbusCookie = configuration.network.javbusCookie.trim();
      if (javbusCookie) {
        try {
          const html = await networkClient.getText("https://www.javbus.com/forum/", {
            headers: { cookie: javbusCookie },
          });
          const valid = !html.includes('login"') || html.includes("logout");
          results.push({ site: "JavBus", valid, message: valid ? "Cookie 有效" : "Cookie 无效或已过期" });
        } catch (error) {
          results.push({ site: "JavBus", valid: false, message: `请求失败: ${toErrorMessage(error)}` });
        }
      } else {
        results.push({ site: "JavBus", valid: false, message: "未配置 Cookie" });
      }

      return { results };
    }),
  };
};
