import type { Configuration } from "@mdcz/shared/config";
import {
  DEFAULT_LLM_BASE_URL,
  type LlmApiFormat,
  type LlmOutputFormat,
  type LlmReasoning,
  type LlmServiceType,
} from "@mdcz/shared/llm";
import { toErrorMessage } from "../../../shared";

type LlmHeadersInit = Headers | Record<string, string> | Array<[string, string]>;

export interface LlmApiTransport {
  postJsonDetailed<TResponse>(
    url: string,
    payload: unknown,
    init?: { headers?: LlmHeadersInit; signal?: AbortSignal; timeout?: number },
  ): Promise<RuntimeNetworkJsonResponse<TResponse>>;
}

export interface RuntimeNetworkJsonResponse<T = unknown> {
  ok: boolean;
  status: number;
  statusText: string;
  resolvedUrl: string;
  headers: Headers;
  data: T | string | null;
}

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

export type LlmRequestConfig = Pick<
  Configuration["translate"],
  | "llmModelName"
  | "llmApiKey"
  | "llmBaseUrl"
  | "llmApiFormat"
  | "llmTemperature"
  | "llmReasoning"
  | "llmServiceType"
  | "llmOutputFormat"
  | "llmTimeout"
>;

export const toLlmTextRequest = (
  config: LlmRequestConfig,
  prompt: string,
  outputSchema?: LlmJsonSchema,
): LlmTextRequest => ({
  model: config.llmModelName,
  apiKey: config.llmApiKey,
  baseUrl: config.llmBaseUrl,
  apiFormat: config.llmApiFormat,
  temperature: config.llmTemperature ?? undefined,
  prompt,
  reasoning: config.llmReasoning,
  serviceType: config.llmServiceType,
  outputFormat: config.llmOutputFormat,
  outputSchema,
  timeout: Math.max(1, Math.trunc(config.llmTimeout)) * 1000,
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

class FetchLlmApiTransport implements LlmApiTransport {
  async postJsonDetailed<TResponse>(
    url: string,
    payload: unknown,
    init: { headers?: LlmHeadersInit; signal?: AbortSignal; timeout?: number } = {},
  ): Promise<RuntimeNetworkJsonResponse<TResponse>> {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    const { signal, cleanup } = this.resolveSignal(init.signal, init.timeout);
    let response: Response;

    try {
      response = await globalThis.fetch(url, {
        body: JSON.stringify(payload),
        headers,
        method: "POST",
        signal,
      });
    } finally {
      cleanup();
    }

    return {
      data: await this.parseJsonResponseBody<TResponse>(response),
      headers: response.headers,
      ok: response.ok,
      resolvedUrl: response.url || url,
      status: response.status,
      statusText: response.statusText,
    };
  }

  private async parseJsonResponseBody<TResponse>(response: Response): Promise<TResponse | string | null> {
    const text = await response.text();
    if (!text.trim()) {
      return null;
    }

    try {
      return JSON.parse(text) as TResponse;
    } catch {
      return text;
    }
  }

  private resolveSignal(signal?: AbortSignal, timeout?: number): { signal?: AbortSignal; cleanup: () => void } {
    if (!timeout || !Number.isFinite(timeout)) {
      return { signal, cleanup: () => undefined };
    }

    const controller = new AbortController();
    const timeoutMs = Math.max(1, Math.trunc(timeout));
    const onAbort = () => controller.abort(signal?.reason);
    const timeoutId = globalThis.setTimeout(() => {
      controller.abort(new Error(`Request timeout (${timeoutMs} ms)`));
    }, timeoutMs);

    if (signal?.aborted) {
      onAbort();
    } else {
      signal?.addEventListener("abort", onAbort, { once: true });
    }

    return {
      signal: controller.signal,
      cleanup: () => {
        globalThis.clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
      },
    };
  }
}

export class LlmApiClient {
  constructor(private readonly transport: LlmApiTransport = new FetchLlmApiTransport()) {}

  async generateText(request: LlmTextRequest, signal?: AbortSignal): Promise<string | null> {
    if (request.reasoning === "enabled" && request.serviceType !== "deepseek") {
      throw new Error(
        "Explicitly enabling with default effort is only supported for DeepSeek; please use server default or specify effort",
      );
    }
    if (request.serviceType === "google" && request.reasoning === "max") {
      throw new Error("Google OpenAI-compatible endpoint does not support max reasoning effort");
    }
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
    if (request.serviceType === "deepseek" && request.outputFormat === "json_schema") {
      throw new Error("DeepSeek does not support JSON Schema output; select prompt JSON or JSON Object");
    }
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
    init?: { headers?: LlmHeadersInit; signal?: AbortSignal; timeout?: number },
  ): Promise<RuntimeNetworkJsonResponse<TResponse>> {
    try {
      return await this.transport.postJsonDetailed<TResponse>(url, payload, init);
    } catch (error) {
      throw new LlmTransportError(`LLM request failed for ${url}: ${toErrorMessage(error)}`, error);
    }
  }

  private requireExtractedText(
    url: string,
    response: RuntimeNetworkJsonResponse<unknown>,
    text: string | null,
  ): string | null {
    if (typeof text === "string" && text.trim()) {
      return text;
    }

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

  private toLlmApiError(url: string, response: RuntimeNetworkJsonResponse<unknown>): LlmApiError {
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
