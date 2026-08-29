import type { ServiceContainer } from "@main/container";
import { configManager } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import { LlmApiClient } from "@mdcz/runtime/scrape";
import { testLlmConnectivity } from "@mdcz/runtime/translate";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { IpcRouterContract } from "@mdcz/shared/ipcContract";
import { translateTestLlmInputSchema } from "../payloads";
import { t } from "../shared";

const logger = loggerService.getLogger("TranslateTestLlm");

export const createTranslateHandlers = (
  context: ServiceContainer,
): Pick<IpcRouterContract, typeof IpcChannel.Translate_TestLlm> => {
  const llmApiClient = new LlmApiClient(context.networkClient);

  return {
    [IpcChannel.Translate_TestLlm]: t.procedure.input(translateTestLlmInputSchema).action(async ({ input }) => {
      const config = await configManager.getValidated();
      return await testLlmConnectivity(input, config, llmApiClient, logger);
    }),
  };
};
