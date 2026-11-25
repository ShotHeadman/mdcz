import type { LlmConnectionSettings } from "@mdcz/shared/config";
import {
  type LlmApiFormat,
  type LlmOutputFormat,
  type LlmReasoning,
  type LlmServiceType,
  llmServiceChoices,
  normalizeLlmBaseUrl,
} from "@mdcz/shared/llm";
import type { RuntimeJsonResponse, RuntimeNetworkClient, RuntimeRequestInit } from "../network";
import { toErrorMessage } from "../shared";

export interface LlmTextRequest {
  model: string;
  apiKey: string;
  baseUrl: string;
  apiFormat: LlmApiFormat;
  temperature?: number;
  prompt: string;
  reasoning: LlmReasoning;
  serviceType: LlmServiceType;
  outputFormat: LlmOutputFormat;
  outputSchema?: LlmJsonSchema;
  timeout?: number;
}

export interface LlmJsonSchema {
  name: string;
  schema: Record<string, unknown>;
}

export const toLlmTextRequest = (
  settings: LlmConnectionSettings,
  prompt: string,
  outputSchema?: LlmJsonSchema,
): LlmTextRequest => ({
  model: settings.modelName,
  apiKey: settings.apiKey,
  baseUrl: settings.baseUrl,
  apiFormat: settings.apiFormat,
  temperature: settings.temperature ?? undefined,
  prompt,
  reasoning: settings.reasoning,
  serviceType: settings.serviceType,
  outputFormat: settings.outputFormat,
  outputSchema,
  timeout: Math.max(1, Math.trunc(settings.timeout)) * 1000,
});

interface ResponsesApiResponse {
  output_text?: string | null;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
  message?: string;
}

interface ChatCompletionsResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
  message?: string;
}

export class LlmApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly headers: Headers,
    readonly data: unknown,
  ) {
    super(message);
  }
}

export class LlmTransportError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "LlmTransportError";
  }
}

/** Reasoning models may open with their thinking even when asked for the answer alone. */
const LEADING_THINK_BLOCK = /^\s*<think>[\s\S]*?<\/think>/iu;

/** Requests go through the app's network client, so they follow its proxy. */
export class LlmApiClient {
  constructor(private readonly network: Pick<RuntimeNetworkClient, "postJsonDetailed">) {}

  async generateText(request: LlmTextRequest, signal?: AbortSignal): Promise<string | null> {
    const choices = llmServiceChoices(request.serviceType);
    if (!choices.reasoning.includes(request.reasoning))
      throw new Error(
        `${request.serviceType} does not accept reasoning "${request.reasoning}"; choose another in Settings`,
      );
    if (!choices.outputFormat.includes(request.outputFormat))
      throw new Error(
        `${request.serviceType} does not accept output format "${request.outputFormat}"; choose another in Settings`,
      );
    const baseUrl = normalizeLlmBaseUrl(request.baseUrl);
    const headers = this.buildHeaders(request.apiKey);
    if (request.serviceType !== "openai-compatible" || request.apiFormat === "chat-completions") {
      return await this.requestChatCompletions(baseUrl, request, headers, signal);
    }

    const responsesUrl = `${baseUrl}/responses`;
    const responsesResponse = await this.postJsonDetailed<ResponsesApiResponse>(
      responsesUrl,
      {
        model: request.model,
        input: request.prompt,
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.reasoning === "default"
          ? {}
          : { reasoning: { effort: request.reasoning === "disabled" ? "none" : request.reasoning } }),
        ...this.buildOutputFormat(request, "responses"),
      },
      { headers, signal, timeout: request.timeout },
    );

    if (responsesResponse.ok) {
      return this.requireExtractedText(
        responsesUrl,
        responsesResponse,
        this.extractResponsesText(responsesResponse.data),
      );
    }

    throw this.toLlmApiError(responsesUrl, responsesResponse);
  }

  private async requestChatCompletions(
    baseUrl: string,
    request: LlmTextRequest,
    headers: Headers,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const chatUrl = `${baseUrl}/chat/completions`;
    const response = await this.postJsonDetailed<ChatCompletionsResponse>(
      chatUrl,
      {
        model: request.model,
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...this.buildChatReasoning(request, request.serviceType),
        ...this.buildOutputFormat(request, "chat-completions"),
        messages: [
          {
            role: "user",
            content: request.prompt,
          },
        ],
      },
      { headers, signal, timeout: request.timeout },
    );

    if (!response.ok) {
      throw this.toLlmApiError(chatUrl, response);
    }

    return this.requireExtractedText(chatUrl, response, this.extractChatCompletionsText(response.data));
  }

  private buildChatReasoning(request: LlmTextRequest, provider: LlmServiceType): Record<string, unknown> {
    if (request.reasoning === "default") return {};
    if (provider === "deepseek") {
      return {
        thinking: { type: request.reasoning === "disabled" ? "disabled" : "enabled" },
        ...(request.reasoning === "disabled" || request.reasoning === "enabled"
          ? {}
          : { reasoning_effort: request.reasoning }),
      };
    }
    return { reasoning_effort: request.reasoning === "disabled" ? "none" : request.reasoning };
  }

  private buildOutputFormat(request: LlmTextRequest, apiFormat: LlmApiFormat): Record<string, unknown> {
    if (request.outputFormat === "none") return {};
    const useJsonObject = request.outputFormat === "json_object";
    if (apiFormat === "chat-completions") {
      if (useJsonObject) return { response_format: { type: "json_object" } };
      if (!request.outputSchema) throw new Error("JSON schema output requires an explicit schema");
      return {
        response_format: {
          type: "json_schema",
          json_schema: { ...request.outputSchema, strict: true },
        },
      };
    }
    if (useJsonObject) return { text: { format: { type: "json_object" } } };
    if (!request.outputSchema) throw new Error("JSON schema output requires an explicit schema");
    return {
      text: {
        format: { type: "json_schema", ...request.outputSchema, strict: true },
      },
    };
  }

  private buildHeaders(apiKey: string): Headers {
    const headers = new Headers();
    if (apiKey.trim()) {
      headers.set("authorization", `Bearer ${apiKey.trim()}`);
    }
    return headers;
  }

  private async postJsonDetailed<TResponse>(
    url: string,
    payload: unknown,
    init: RuntimeRequestInit,
  ): Promise<RuntimeJsonResponse<TResponse>> {
    try {
      return await this.network.postJsonDetailed<TResponse>(url, payload, init);
    } catch (error) {
      throw new LlmTransportError(`LLM request failed for ${url}: ${toErrorMessage(error)}`, error);
    }
  }

  private requireExtractedText(
    url: string,
    response: RuntimeJsonResponse<unknown>,
    text: string | null,
  ): string | null {
    const answer = text?.replace(LEADING_THINK_BLOCK, "").trim();
    if (answer) return answer;

    throw new LlmApiError(
      `LLM response did not contain text for ${url}: ${this.summarizeResponseData(response.data)}`,
      response.status,
      response.headers,
      response.data,
    );
  }

  private summarizeResponseData(data: unknown): string {
    const text = typeof data === "string" ? data : JSON.stringify(data);
    if (!text || text.trim().length === 0) {
      return "(empty body)";
    }
    return text.length > 500 ? `${text.slice(0, 500)}...` : text;
  }

  private extractResponsesText(data: ResponsesApiResponse | string | null): string | null {
    if (typeof data === "string") {
      return data.trim() || null;
    }

    if (!this.isRecord(data)) {
      return null;
    }

    if (typeof data.output_text === "string" && data.output_text.trim()) {
      return data.output_text.trim();
    }

    const texts: string[] = [];
    if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (!this.isRecord(item) || item.type !== "message" || !Array.isArray(item.content)) {
          continue;
        }

        for (const contentPart of item.content) {
          if (
            !this.isRecord(contentPart) ||
            contentPart.type !== "output_text" ||
            typeof contentPart.text !== "string"
          ) {
            continue;
          }

          const trimmed = contentPart.text.trim();
          if (trimmed) {
            texts.push(trimmed);
          }
        }
      }
    }

    return texts.length > 0 ? texts.join("\n") : null;
  }

  private extractChatCompletionsText(data: ChatCompletionsResponse | string | null): string | null {
    if (typeof data === "string") {
      return data.trim() || null;
    }

    if (!this.isRecord(data) || !Array.isArray(data.choices)) {
      return null;
    }

    const content = data.choices[0]?.message?.content;
    if (typeof content === "string") {
      return content.trim() || null;
    }

    if (!Array.isArray(content)) {
      return null;
    }

    const texts = content
      .filter((part): part is { text: string } => this.isRecord(part) && typeof part.text === "string")
      .map((part) => part.text.trim())
      .filter((text) => text.length > 0);

    return texts.length > 0 ? texts.join("\n") : null;
  }

  private toLlmApiError(url: string, response: RuntimeJsonResponse<unknown>): LlmApiError {
    const baseMessage = `HTTP ${response.status} ${response.statusText} for ${url}`;
    const detail = this.extractErrorDetail(response.data);
    return new LlmApiError(
      detail ? `${baseMessage}: ${detail}` : baseMessage,
      response.status,
      response.headers,
      response.data,
    );
  }

  private extractErrorDetail(data: unknown): string {
    if (typeof data === "string") {
      return data.trim();
    }

    if (!this.isRecord(data)) {
      return "";
    }

    const error = data.error;
    if (this.isRecord(error) && typeof error.message === "string") {
      return error.message.trim();
    }

    if (typeof data.message === "string") {
      return data.message.trim();
    }

    return "";
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
}
