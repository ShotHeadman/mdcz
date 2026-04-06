import type { NetworkJsonResponse } from "@main/services/network";
import { NetworkClient } from "@main/services/network";
import { DEFAULT_LLM_BASE_URL } from "@shared/llm";

type LlmHeadersInit = Headers | Record<string, string> | Array<[string, string]>;

export interface LlmApiTransport {
  postJsonDetailed<TResponse>(
    url: string,
    payload: unknown,
    init?: { headers?: LlmHeadersInit; signal?: AbortSignal },
  ): Promise<NetworkJsonResponse<TResponse>>;
}

export interface LlmTextRequest {
  model: string;
  apiKey: string;
  baseUrl: string;
  temperature: number;
  prompt: string;
}

interface ResponsesApiResponse {
  output_text?: string | null;
  output?: Array<{
    content?: Array<{
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

const RESPONSES_UNSUPPORTED_STATUS_CODES = new Set([404, 405, 415, 422, 501]);

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

export const normalizeLlmBaseUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return DEFAULT_LLM_BASE_URL;
  }

  return trimmed.replace(/\/+$/u, "");
};

export const isOfficialOpenAiBaseUrl = (baseUrl: string): boolean =>
  normalizeLlmBaseUrl(baseUrl) === DEFAULT_LLM_BASE_URL;

export const isMissingRequiredLlmApiKey = (baseUrl: string, apiKey: string): boolean =>
  isOfficialOpenAiBaseUrl(baseUrl) && apiKey.trim().length === 0;

export class LlmApiClient {
  constructor(private readonly transport: LlmApiTransport = new NetworkClient()) {}

  async generateText(request: LlmTextRequest, signal?: AbortSignal): Promise<string | null> {
    const baseUrl = normalizeLlmBaseUrl(request.baseUrl);
    const headers = this.buildHeaders(request.apiKey);
    const responsesUrl = `${baseUrl}/responses`;
    const responsesResponse = await this.transport.postJsonDetailed<ResponsesApiResponse>(
      responsesUrl,
      {
        model: request.model,
        input: request.prompt,
        temperature: request.temperature,
      },
      { headers, signal },
    );

    if (responsesResponse.ok) {
      return this.extractResponsesText(responsesResponse.data);
    }

    if (this.shouldFallbackToChatCompletions(responsesResponse)) {
      return await this.requestChatCompletions(baseUrl, request, headers, signal);
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
    const response = await this.transport.postJsonDetailed<ChatCompletionsResponse>(
      chatUrl,
      {
        model: request.model,
        temperature: request.temperature,
        messages: [
          {
            role: "user",
            content: request.prompt,
          },
        ],
      },
      { headers, signal },
    );

    if (!response.ok) {
      throw this.toLlmApiError(chatUrl, response);
    }

    return this.extractChatCompletionsText(response.data);
  }

  private buildHeaders(apiKey: string): Headers {
    const headers = new Headers();
    if (apiKey.trim()) {
      headers.set("authorization", `Bearer ${apiKey.trim()}`);
    }
    return headers;
  }

  private shouldFallbackToChatCompletions(response: NetworkJsonResponse<ResponsesApiResponse>): boolean {
    if (RESPONSES_UNSUPPORTED_STATUS_CODES.has(response.status)) {
      return true;
    }

    const detail = this.extractErrorDetail(response.data).toLowerCase();
    return (
      detail.includes("/responses") ||
      detail.includes("responses api") ||
      (detail.includes("responses") &&
        (detail.includes("unsupported") ||
          detail.includes("not support") ||
          detail.includes("not found") ||
          detail.includes("unknown") ||
          detail.includes("unrecognized")))
    );
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
        if (!this.isRecord(item) || !Array.isArray(item.content)) {
          continue;
        }
        for (const contentPart of item.content) {
          if (!this.isRecord(contentPart) || typeof contentPart.text !== "string") {
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

  private toLlmApiError(url: string, response: NetworkJsonResponse<unknown>): LlmApiError {
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
