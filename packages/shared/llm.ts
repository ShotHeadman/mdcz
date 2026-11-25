export const DEFAULT_LLM_BASE_URL = "https://api.openai.com/v1";

export const LLM_REASONING_EFFORT_OPTIONS = ["low", "medium", "high", "max"] as const;

export const LLM_API_FORMAT_OPTIONS = ["responses", "chat-completions"] as const;
export type LlmApiFormat = (typeof LLM_API_FORMAT_OPTIONS)[number];
export const LLM_REASONING_OPTIONS = ["default", "disabled", "enabled", ...LLM_REASONING_EFFORT_OPTIONS] as const;
export type LlmReasoning = (typeof LLM_REASONING_OPTIONS)[number];

export const LLM_SERVICE_TYPE_OPTIONS = ["openai-compatible", "google", "deepseek"] as const;
export type LlmServiceType = (typeof LLM_SERVICE_TYPE_OPTIONS)[number];

export const LLM_OUTPUT_FORMAT_OPTIONS = ["none", "json_object", "json_schema"] as const;
export type LlmOutputFormat = (typeof LLM_OUTPUT_FORMAT_OPTIONS)[number];

/** The reasoning and output choices each service accepts: the settings forms offer only these, and requests refuse the rest. */
export const llmServiceChoices = (
  serviceType: LlmServiceType,
): { reasoning: readonly LlmReasoning[]; outputFormat: readonly LlmOutputFormat[] } =>
  serviceType === "deepseek"
    ? { reasoning: ["default", "disabled", "enabled", "low", "high", "max"], outputFormat: ["none", "json_object"] }
    : { reasoning: ["default", "disabled", "low", "medium", "high"], outputFormat: LLM_OUTPUT_FORMAT_OPTIONS };

/** A connection moved to another service keeps the choices that service accepts and takes the nearest one otherwise. */
export const fitLlmChoices = <
  T extends { serviceType: LlmServiceType; reasoning: LlmReasoning; outputFormat: LlmOutputFormat },
>(
  connection: T,
): T => {
  const choices = llmServiceChoices(connection.serviceType);
  return {
    ...connection,
    reasoning: choices.reasoning.includes(connection.reasoning) ? connection.reasoning : "default",
    outputFormat: choices.outputFormat.includes(connection.outputFormat) ? connection.outputFormat : "json_object",
  };
};

export const normalizeLlmBaseUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return DEFAULT_LLM_BASE_URL;
  }

  return trimmed.replace(/\/+$/u, "").replace(/\/(chat\/completions|responses)$/iu, "");
};

export const isOfficialOpenAiBaseUrl = (baseUrl: string): boolean =>
  normalizeLlmBaseUrl(baseUrl) === DEFAULT_LLM_BASE_URL;

export const isMissingRequiredLlmApiKey = (baseUrl: string, apiKey: string): boolean =>
  isOfficialOpenAiBaseUrl(baseUrl) && apiKey.trim().length === 0;

export type MissingLlmSetting = "missing_model" | "missing_credentials";

/** Every required field missing from the connection, in display order. */
export const missingLlmSettings = (settings: {
  modelName: string;
  baseUrl: string;
  apiKey: string;
}): MissingLlmSetting[] => {
  const missing: MissingLlmSetting[] = [];
  if (!settings.modelName.trim()) missing.push("missing_model");
  if (isMissingRequiredLlmApiKey(settings.baseUrl, settings.apiKey)) missing.push("missing_credentials");
  return missing;
};

/** Null when the connection has enough information to send a request; otherwise the first missing item. */
export const missingLlmSetting = (settings: {
  modelName: string;
  baseUrl: string;
  apiKey: string;
}): MissingLlmSetting | null => missingLlmSettings(settings)[0] ?? null;
