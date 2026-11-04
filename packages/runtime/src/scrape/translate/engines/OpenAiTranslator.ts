import { setTimeout as sleep } from "node:timers/promises";
import type { Configuration } from "@mdcz/shared/config";
import PQueue from "p-queue";
import { z } from "zod";
import { parseRetryAfterMs, readRetryAfterHeader, toErrorMessage } from "../../../shared";
import { isAbortError, throwIfAborted } from "../../utils/abort";
import { getTargetLanguageLabel } from "../shared";
import type { LanguageTarget } from "../types";
import {
  isMissingRequiredLlmApiKey,
  type LlmApiClient,
  type LlmJsonSchema,
  LlmTransportError,
  toLlmTextRequest,
} from "./LlmApiClient";

interface TranslationLogger {
  warn(message: string): void;
}

const OPENAI_RETRY_STATUS_CODE = 429;
const RETRY_AFTER_CAP_MS = 15_000;
const REQUEST_TIMEOUT_PATTERN =
  /request timeout|timed ?out|timeout \(\d+ ms\)|error reading response stream|kind: *body|econnreset|etimedout/iu;
const COMPLETE_LEADING_THINK_PATTERN = /^<think>[\s\S]*?<\/think>\s*/iu;
const TRANSLATION_ONLY_INSTRUCTION = "只输出最终译文，不要输出思考过程、解释、提示词或原文。";
const JSON_TRANSLATION_INSTRUCTION = '只输出 JSON 对象，格式为 {"translation":"最终译文"}，不要添加其他字段。';

const textTranslationSchema = z.strictObject({ translation: z.string().trim().min(1) });
const metadataTranslationSchema = z.strictObject({
  title: z.string().trim().min(1).nullable(),
  plot: z.string().trim().min(1).nullable(),
  genres: z.array(z.string().trim().min(1)),
});

export const LLM_TEXT_TRANSLATION_SCHEMA: LlmJsonSchema = {
  name: "text_translation",
  schema: z.toJSONSchema(textTranslationSchema),
};

export const LLM_METADATA_TRANSLATION_SCHEMA: LlmJsonSchema = {
  name: "metadata_translation",
  schema: z.toJSONSchema(metadataTranslationSchema),
};

const fileNumberSchema = z.strictObject({ number: z.string().trim().min(1).nullable() });
const LLM_FILE_NUMBER_SCHEMA: LlmJsonSchema = { name: "file_number", schema: z.toJSONSchema(fileNumberSchema) };

const buildTranslationPrompt = (prompt: string): string => `${prompt.trim()}

${TRANSLATION_ONLY_INSTRUCTION}`;

export const buildLlmTranslatePrompt = (
  promptTemplate: string,
  text: string,
  target: LanguageTarget,
  structured = false,
): string => {
  const prompt = promptTemplate.replaceAll("{lang}", getTargetLanguageLabel(target)).replaceAll("{content}", text);
  return `${prompt.trim()}\n\n${structured ? JSON_TRANSLATION_INSTRUCTION : TRANSLATION_ONLY_INSTRUCTION}`;
};

export const cleanTranslationOutput = (
  output: string | null,
  prompt: string,
  source: string,
  structured = false,
): string | null => {
  if (typeof output !== "string") {
    return null;
  }

  const cleaned = output.replace(COMPLETE_LEADING_THINK_PATTERN, "").trim();
  let translated = cleaned;
  if (structured) {
    try {
      translated = textTranslationSchema.parse(JSON.parse(cleaned)).translation;
    } catch {
      return null;
    }
  }
  const normalizedPrompt = prompt.trim();
  const normalizedSource = source.trim();
  if (
    !translated ||
    translated === normalizedPrompt ||
    translated === normalizedSource ||
    translated === buildTranslationPrompt(prompt)
  ) {
    return null;
  }

  return translated;
};

interface RetryDecision {
  delayMs: number;
  reason: string;
}

export type LlmMetadataTranslationInput = z.infer<typeof metadataTranslationSchema>;
export type LlmMetadataTranslationResult = z.infer<typeof metadataTranslationSchema>;

export class OpenAiTranslator {
  private readonly requestQueues = new Map<number, PQueue>();

  constructor(
    private readonly logger: TranslationLogger,
    private readonly llmApiClient: LlmApiClient,
  ) {}

  async translateText(
    text: string,
    target: LanguageTarget,
    config: Configuration,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (
      !config.translate.llmModelName.trim() ||
      isMissingRequiredLlmApiKey(config.translate.llmBaseUrl, config.translate.llmApiKey)
    ) {
      return null;
    }

    throwIfAborted(signal);

    const structured = config.translate.llmOutputFormat !== "none";
    const contractedPrompt = buildLlmTranslatePrompt(config.translate.llmPrompt, text, target, structured);
    const content = await this.requestText(
      config,
      contractedPrompt,
      signal,
      structured ? LLM_TEXT_TRANSLATION_SCHEMA : undefined,
    );
    const translation = cleanTranslationOutput(content, config.translate.llmPrompt, text, structured);
    if (!translation) throw new Error("LLM translation returned invalid output");
    return translation;
  }

  async translateMetadata(
    input: LlmMetadataTranslationInput,
    target: LanguageTarget,
    config: Configuration,
    signal?: AbortSignal,
  ): Promise<LlmMetadataTranslationResult> {
    if (!input.title && !input.plot && input.genres.length === 0) {
      return { title: null, plot: null, genres: [] };
    }
    if (
      !config.translate.llmModelName.trim() ||
      isMissingRequiredLlmApiKey(config.translate.llmBaseUrl, config.translate.llmApiKey)
    ) {
      throw new Error("LLM metadata translation requires a model and the endpoint's required API key");
    }

    throwIfAborted(signal);

    const prompt = [
      `将输入 JSON 中的影片元数据翻译为${getTargetLanguageLabel(target)}。`,
      '只返回一个 JSON 对象，字段固定为 "title"、"plot" 和 "genres"。',
      "title 和 plot 为 null 时保持 null，否则只返回最终译文。",
      `genres 必须返回 ${input.genres.length} 项，顺序与输入完全一致，每项只包含一个简短标签。`,
      "不要返回解释、Markdown、提示词或原文之外的额外字段。",
      "输入 JSON：",
      JSON.stringify(input),
    ].join("\n");
    const content = await this.requestText(config, prompt, signal, LLM_METADATA_TRANSLATION_SCHEMA);
    try {
      const parsed = metadataTranslationSchema.parse(JSON.parse(content ?? ""));
      if (
        (input.title === null) !== (parsed.title === null) ||
        (input.plot === null) !== (parsed.plot === null) ||
        parsed.genres.length !== input.genres.length
      ) {
        throw new Error("title/plot nullability or genre count does not match the input");
      }
      return parsed;
    } catch (error) {
      throw new Error(`LLM metadata translation returned invalid structured output: ${toErrorMessage(error)}`, {
        cause: error,
      });
    }
  }

  /** Reads the number out of a file name whose parsed number no site has; the caller checks the answer against the name. */
  async readFileNumber(
    fileName: string,
    missedNumber: string,
    config: Configuration,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (
      !config.translate.llmModelName.trim() ||
      isMissingRequiredLlmApiKey(config.translate.llmBaseUrl, config.translate.llmApiKey)
    ) {
      throw new Error("AI number reading requires an LLM model and the endpoint's required API key");
    }

    throwIfAborted(signal);

    const prompt = [
      "从视频文件名中找出影片番号。文件名常夹杂网址、域名、广告语、画质或字幕标记等无关文字。",
      `按常规规则识别出的「${missedNumber}」在所有站点都找不到，很可能是误识别。`,
      "只能使用文件名中实际出现的字母和数字，不要根据片名、演员或记忆推测番号。",
      "网址和域名（如 www.98t.la、hhd800.com）里的字符不是番号。",
      "常见番号形如 ABC-123、300MIUM-123、FC2-PPV-1234567、HEYZO-1234、123456_789，字母段与数字段之间用连字符连接。",
      '只返回一个 JSON 对象，格式为 {"number":"番号"}；找不到番号时返回 {"number":null}。不要返回解释或其他字段。',
      `文件名：${fileName}`,
    ].join("\n");
    const content = await this.requestText(config, prompt, signal, LLM_FILE_NUMBER_SCHEMA);
    try {
      // Without a JSON output mode, models may wrap the object in a think block or a code fence.
      const json = (content ?? "").replace(COMPLETE_LEADING_THINK_PATTERN, "").match(/\{[\s\S]*\}/u)?.[0] ?? "";
      return fileNumberSchema.parse(JSON.parse(json)).number;
    } catch (error) {
      throw new Error(`AI number reading returned invalid output: ${toErrorMessage(error)}`, { cause: error });
    }
  }

  private requestText(config: Configuration, prompt: string, signal?: AbortSignal, outputSchema?: LlmJsonSchema) {
    return this.executeRequestWithRetry(
      config,
      () => this.llmApiClient.generateText(toLlmTextRequest(config.translate, prompt, outputSchema), signal),
      signal,
    );
  }

  private getRequestsPerSecond(config: Configuration): number {
    return config.translate.llmMaxRequestsPerSecond;
  }

  private getQueue(config: Configuration): PQueue {
    const requestsPerSecond = this.getRequestsPerSecond(config);
    const existing = this.requestQueues.get(requestsPerSecond);
    if (existing) {
      return existing;
    }

    const queue = new PQueue({
      concurrency: 1,
      interval: 1000,
      intervalCap: requestsPerSecond,
    });
    this.requestQueues.set(requestsPerSecond, queue);
    return queue;
  }

  private async executeRequestWithRetry<T>(
    config: Configuration,
    request: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const maxRetryCount = config.translate.llmMaxRetries;
    let attempt = 0;

    while (true) {
      try {
        const queue = this.getQueue(config);
        return await queue.add(
          async () => {
            throwIfAborted(signal);
            return request();
          },
          signal ? { signal } : undefined,
        );
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        if (attempt >= maxRetryCount) {
          throw error;
        }

        const retryDecision = this.getRetryDecision(error, attempt);
        if (!retryDecision) {
          throw error;
        }

        attempt += 1;
        this.logger.warn(
          `LLM request retrying after ${retryDecision.reason} (${attempt}/${maxRetryCount}) in ${retryDecision.delayMs}ms`,
        );
        await sleep(retryDecision.delayMs, undefined, signal ? { signal } : undefined);
      }
    }
  }

  private getRetryDecision(error: unknown, attempt: number): RetryDecision | null {
    if (error instanceof LlmTransportError) {
      return { delayMs: this.getExponentialDelayMs(attempt), reason: "transport error" };
    }

    if (!error || typeof error !== "object") {
      return null;
    }

    const status = (error as { status?: unknown }).status;
    if (status !== OPENAI_RETRY_STATUS_CODE) {
      if (this.isRetryableTimeout(error)) {
        return { delayMs: this.getExponentialDelayMs(attempt), reason: "timeout" };
      }
      return null;
    }

    const headers =
      (error as { headers?: unknown }).headers ?? (error as { response?: { headers?: unknown } }).response?.headers;

    const rawRetryAfter = readRetryAfterHeader(headers);
    const parsed = parseRetryAfterMs(rawRetryAfter);
    if (parsed !== null) {
      return { delayMs: Math.min(parsed, RETRY_AFTER_CAP_MS), reason: "HTTP 429" };
    }

    return { delayMs: this.getExponentialDelayMs(attempt), reason: "HTTP 429" };
  }

  private getExponentialDelayMs(attempt: number): number {
    return Math.min(1000 * 2 ** attempt, RETRY_AFTER_CAP_MS);
  }

  private isRetryableTimeout(error: unknown): boolean {
    const message = toErrorMessage(error);
    return REQUEST_TIMEOUT_PATTERN.test(message);
  }
}
