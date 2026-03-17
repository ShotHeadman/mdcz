import { configManager, configurationSchema } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import { toErrorMessage } from "@main/utils/common";
import { IpcChannel } from "@shared/IpcChannel";
import type { IpcRouterContract } from "@shared/ipcContract";
import type { TranslateTestLlmInput } from "@shared/ipcTypes";
import OpenAI from "openai";
import { t } from "../shared";

const logger = loggerService.getLogger("TranslateTestLlm");

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

      if (!llmApiKey.trim()) {
        return { success: false, message: "请先填写 LLM 密钥" };
      }

      logger.info(`Test LLM connectivity: model=${llmModelName}, baseURL=${llmBaseUrl || "(default)"}`);

      const client = new OpenAI({
        apiKey: llmApiKey,
        baseURL: llmBaseUrl || undefined,
        timeout: 10_000,
      });

      try {
        const response = await client.chat.completions.create({
          model: llmModelName,
          temperature: Math.min(2, Math.max(0, llmTemperature)),
          messages: [
            {
              role: "user",
              content: "请直接说出一个比1大的质数",
            },
          ],
        });

        const content = response.choices[0]?.message?.content;
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
