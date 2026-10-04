import type { ServiceContainer } from "@main/container";
import { configManager } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import { testTranslation } from "@mdcz/runtime/translate";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { IpcRouterContract } from "@mdcz/shared/ipcContract";
import { translateTestInputSchema } from "@mdcz/shared/serverDtos";
import { t } from "../shared";

const logger = loggerService.getLogger("TranslateTest");

export const createTranslateHandlers = (
  context: ServiceContainer,
): Pick<IpcRouterContract, typeof IpcChannel.Translate_Test> => {
  return {
    [IpcChannel.Translate_Test]: t.procedure.input(translateTestInputSchema).action(async ({ input }) => {
      const config = await configManager.getValidated();
      return await testTranslation(input, config, context.networkClient, { logger });
    }),
  };
};
