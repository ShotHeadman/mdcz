import { configManager, configurationSchema } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import { NetworkClient } from "@main/services/network";
import {
  isMissingRequiredLlmApiKey,
  LlmApiClient,
  normalizeLlmBaseUrl,
} from "@main/services/scraper/translate/engines/LlmApiClient";
import { toErrorMessage } from "@main/utils/common";
import { IpcChannel } from "@shared/IpcChannel";
import type { IpcRouterContract } from "@shared/ipcContract";
import type { TranslateTestLlmInput } from "@shared/ipcTypes";
import { t } from "../shared";

const logger = loggerService.getLogger("TranslateTestLlm");
const llmApiClient = new LlmApiClient(new NetworkClient({ timeoutMs: 10_000 }));

export const createTranslateHandlers = (): Pick<IpcRouterContract, typeof IpcChannel.Translate_TestLlm> => {
  return {
    [IpcChannel.Translate_TestLlm]: t.procedure.input<TranslateTestLlmInput>().action(async ({ input }) => {
      await configManager.ensureLoaded();
      const config = configurationSchema.parse(await configManager.get());
      const llmModelName = typeof input?.llmModelName === "string" ? input.llmModelName : config.translate.llmModelName;
      const llmApiKey = typeof input?.llmApiKey === "string" ? input.llmApiKey : config.translate.llmApiKey;
      const llmBaseUrl = typeof input?.llmBaseUrl === "string" ? input.llmBaseUrl : config.translate.llmBaseUrl;
      const llmTemperature =
        typeof input?.llmTemperature === "number" && Number.isFinite(input.llmTemperature)
          ? input.llmTemperature
          : config.translate.llmTemperature;

      if (!llmModelName.trim()) {
        return { success: false, message: "请先填写 LLM 模型名称" };
      }

      if (isMissingRequiredLlmApiKey(llmBaseUrl, llmApiKey)) {
        return { success: false, message: "请先填写 LLM 密钥（默认 OpenAI 地址需要）" };
      }

      const normalizedBaseUrl = normalizeLlmBaseUrl(llmBaseUrl);
      logger.info(`Test LLM connectivity: model=${llmModelName}, baseURL=${normalizedBaseUrl}`);

      try {
        const content = await llmApiClient.generateText({
          model: llmModelName,
          apiKey: llmApiKey,
          baseUrl: normalizedBaseUrl,
          temperature: Math.min(2, Math.max(0, llmTemperature)),
          prompt: "请直接说出一个比1大的质数",
        });
        logger.info(`Test LLM connectivity: Success, reply="${content}"`);

        if (typeof content === "string" && content.trim().length > 0) {
          return { success: true, message: `连接成功，LLM 回复: ${content.trim()}` };
        }

        return { success: false, message: "LLM 返回了空内容" };
      } catch (error) {
        const msg = toErrorMessage(error);
        logger.error(`Test LLM connectivity: Failed, error=${msg}`);
        return { success: false, message: `连接失败: ${msg}` };
      }
    }),
  };
};
