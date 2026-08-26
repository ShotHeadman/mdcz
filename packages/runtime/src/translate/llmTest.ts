import type { Configuration } from "@mdcz/shared/config";
import {
  isMissingRequiredLlmApiKey,
  type LlmApiClient,
  normalizeLlmBaseUrl,
} from "../scrape/translate/engines/LlmApiClient";
import { OpenAiTranslator } from "../scrape/translate/engines/OpenAiTranslator";
import type { RuntimeLogger } from "../shared";
import { toErrorMessage } from "../shared";

export interface TranslateTestLlmInput {
  llmModelName?: string;
  llmApiKey?: string;
  llmBaseUrl?: string;
  llmPrompt?: string;
  llmTemperature?: number;
  llmTimeout?: number;
}

export interface TranslateTestLlmResult {
  success: boolean;
  message: string;
}

export const testLlmConnectivity = async (
  input: TranslateTestLlmInput | undefined,
  configuration: Configuration,
  llmApiClient: LlmApiClient,
  logger?: Pick<RuntimeLogger, "error" | "info">,
): Promise<TranslateTestLlmResult> => {
  const llmModelName =
    typeof input?.llmModelName === "string" ? input.llmModelName : configuration.translate.llmModelName;
  const llmApiKey = typeof input?.llmApiKey === "string" ? input.llmApiKey : configuration.translate.llmApiKey;
  const llmBaseUrl = typeof input?.llmBaseUrl === "string" ? input.llmBaseUrl : configuration.translate.llmBaseUrl;
  const llmPrompt = typeof input?.llmPrompt === "string" ? input.llmPrompt : configuration.translate.llmPrompt;
  const llmTimeout =
    typeof input?.llmTimeout === "number" && Number.isFinite(input.llmTimeout)
      ? input.llmTimeout
      : configuration.translate.llmTimeout;

  if (!llmModelName.trim()) {
    return { success: false, message: "请先填写 LLM 模型名称" };
  }

  if (isMissingRequiredLlmApiKey(llmBaseUrl, llmApiKey)) {
    return { success: false, message: "请先填写 LLM 密钥（默认 OpenAI 地址需要）" };
  }

  const normalizedBaseUrl = normalizeLlmBaseUrl(llmBaseUrl);
  logger?.info(`Test LLM connectivity: model=${llmModelName}, baseURL=${normalizedBaseUrl}`);

  try {
    const testConfiguration: Configuration = {
      ...configuration,
      translate: {
        ...configuration.translate,
        llmApiKey,
        llmBaseUrl: normalizedBaseUrl,
        llmModelName,
        llmPrompt,
        llmTemperature: 0,
        llmTimeout: Math.max(1, Math.trunc(llmTimeout)),
      },
    };
    const translator = new OpenAiTranslator({ warn: () => undefined }, llmApiClient);
    const content = await translator.translateText("ある日の暮方の事である。", "zh_cn", testConfiguration);

    if (content) {
      logger?.info("Test LLM connectivity: Success");
      return { success: true, message: `连接成功，LLM 回复: ${content}` };
    }

    return { success: false, message: "LLM 返回内容不符合翻译输出格式，请检查模型与提示词" };
  } catch (error) {
    const message = toErrorMessage(error);
    logger?.error(`Test LLM connectivity: Failed, error=${message}`);
    return { success: false, message: `连接失败: ${message}` };
  }
};
