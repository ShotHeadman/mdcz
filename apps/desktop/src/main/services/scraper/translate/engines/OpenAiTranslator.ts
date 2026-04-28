import { setTimeout as sleep } from "node:timers/promises";
import type { Configuration } from "@main/services/config";
import { toErrorMessage } from "@main/utils/common";
import { parseRetryAfterMs, readRetryAfterHeader } from "@main/utils/http";
import PQueue from "p-queue";
import { isAbortError, throwIfAborted } from "../../abort";
import { getTargetLanguageLabel } from "../shared";
import type { LanguageTarget } from "../types";
import { isMissingRequiredLlmApiKey, type LlmApiClient } from "./LlmApiClient";

interface TranslationLogger {
  warn(message: string): void;
}

const OPENAI_RETRY_STATUS_CODE = 429;
const RETRY_AFTER_CAP_MS = 15_000;
const QUOTE_PATTERN = /^['\u0022\u201C\u201D]+|['\u0022\u201C\u201D]+$/gu;
const REQUEST_TIMEOUT_PATTERN = /request timeout|timed out|timeout \(\d+ ms\)/iu;

interface RetryDecision {
  delayMs: number;
  reason: string;
}

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

    const prompt = config.translate.llmPrompt
      .replaceAll("{lang}", getTargetLanguageLabel(target))
      .replaceAll("{content}", text);

    const content = await this.requestText(config, prompt, config.translate.llmTemperature, signal).catch((error) => {
      if (isAbortError(error)) {
        throw error;
      }
      this.logger.warn(`LLM translation failed: ${toErrorMessage(error)}`);
      return null;
    });

    if (typeof content === "string" && content.trim().length > 0) {
      return content.trim();
    }

    return null;
  }

  async translateSingleLine(prompt: string, config: Configuration, signal?: AbortSignal): Promise<string | null> {
    if (
      !config.translate.llmModelName.trim() ||
      isMissingRequiredLlmApiKey(config.translate.llmBaseUrl, config.translate.llmApiKey)
    ) {
      return null;
    }

    throwIfAborted(signal);

    const content = await this.requestText(config, prompt, 0, signal).catch((error) => {
      if (isAbortError(error)) {
        throw error;
      }
      this.logger.warn(`LLM term translation failed: ${toErrorMessage(error)}`);
      return null;
    });

    if (typeof content !== "string" || content.trim().length === 0) {
      return null;
    }

    const firstLine = content
      .trim()
      .split(/\r?\n/gu)
      .find((line) => line.trim().length > 0);

    return firstLine ? firstLine.trim().replace(QUOTE_PATTERN, "") : null;
  }

  private requestText(config: Configuration, prompt: string, temperature: number, signal?: AbortSignal) {
    return this.executeRequestWithRetry(
      config,
      () =>
        this.llmApiClient.generateText(
          {
            model: config.translate.llmModelName,
            apiKey: config.translate.llmApiKey,
            baseUrl: config.translate.llmBaseUrl,
            temperature,
            prompt,
          },
          signal,
        ),
      signal,
    );
  }

  private getRequestsPerSecond(config: Configuration): number {
    const configured = Number(config.translate.llmMaxRequestsPerSecond);
    if (!Number.isFinite(configured)) {
      return 1;
    }

    return Math.max(1, Math.trunc(configured));
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
    const maxRetryCount = Math.max(0, Math.trunc(config.translate.llmMaxRetries));
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
