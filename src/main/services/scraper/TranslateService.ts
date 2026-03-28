import { setTimeout as sleep } from "node:timers/promises";
import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import { CachedAsyncResolver } from "@main/utils/CachedAsyncResolver";
import { toErrorMessage } from "@main/utils/common";
import { parseRetryAfterMs, readRetryAfterHeader } from "@main/utils/http";
import { convertToSimplified, convertToTraditional, detectLanguage } from "@main/utils/language";
import { appendMappingCandidate, findMappedActorName, findMappedGenreName } from "@main/utils/translate";
import type { TranslationTarget } from "@shared/enums";
import type { ActorProfile, CrawlerData } from "@shared/types";
import OpenAI from "openai";
import PQueue from "p-queue";
import { z } from "zod";
import { isAbortError, throwIfAborted } from "./abort";

type LanguageTarget = "zh_cn" | "zh_tw";

const toTarget = (value: TranslationTarget): LanguageTarget => {
  if (value === "zh-TW") {
    return "zh_tw";
  }
  return "zh_cn";
};

const normalizeNewlines = (value: string): string => value.replace(/\r\n?/gu, "\n");

const normalizeTermKey = (value: string): string => {
  return value.normalize("NFKC").trim().toLowerCase();
};

const ensureTargetChinese = (text: string, target: LanguageTarget): string => {
  if (target === "zh_tw") {
    return convertToTraditional(text);
  }

  return convertToSimplified(text);
};

const googleTranslateResponseSchema = z.array(z.unknown());
const OPENAI_RETRY_STATUS_CODE = 429;
const RETRY_AFTER_CAP_MS = 15_000;

const getTargetLanguageLabel = (target: LanguageTarget): string => {
  if (target === "zh_tw") {
    return "繁体中文";
  }
  return "简体中文";
};

const toTranslatedFieldValue = (value: string): string | undefined => {
  const detected = detectLanguage(value);
  return detected === "zh_cn" || detected === "zh_tw" ? value : undefined;
};

const extractGoogleTranslatedText = (payload: unknown): string | null => {
  const parsed = googleTranslateResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }

  const root = parsed.data;
  const first = root[0];
  if (!Array.isArray(first)) {
    return null;
  }

  const segments: string[] = [];
  for (const segment of first) {
    if (!Array.isArray(segment)) {
      continue;
    }
    const translated = segment[0];
    if (typeof translated === "string" && translated.trim().length > 0) {
      segments.push(translated);
    }
  }

  const result = segments.join("");
  return result.trim().length > 0 ? result : null;
};

export class TranslateService {
  private readonly logger = loggerService.getLogger("TranslateService");

  private readonly actorResolver = new CachedAsyncResolver<string, string>();

  private readonly genreResolver = new CachedAsyncResolver<string, string>();

  private readonly openAiRequestQueues = new Map<number, PQueue>();

  constructor(
    private readonly networkClient: NetworkClient,
    private readonly openAiFactory: (config: Configuration) => OpenAI = (config) =>
      new OpenAI({
        apiKey: config.translate.llmApiKey,
        baseURL: config.translate.llmBaseUrl || undefined,
      }),
  ) {}

  async translateCrawlerData(data: CrawlerData, config: Configuration, signal?: AbortSignal): Promise<CrawlerData> {
    if (!config.translate.enableTranslation) {
      return data;
    }

    throwIfAborted(signal);

    const target = toTarget(config.translate.targetLanguage);

    const title_zh = toTranslatedFieldValue(await this.translateText(data.title, target, config, signal));
    const plot_zh = data.plot
      ? toTranslatedFieldValue(await this.translateText(data.plot, target, config, signal))
      : undefined;

    throwIfAborted(signal);

    const mappedActors = await Promise.all((data.actors ?? []).map((actor) => this.normalizeActorAlias(actor)));
    const mappedActorProfiles = await Promise.all(
      (data.actor_profiles ?? []).map((profile) => this.normalizeActorProfile(profile)),
    );
    const mappedGenres = await Promise.all(
      (data.genres ?? []).map((genre) => this.translateGenreTerm(genre, target, config, signal)),
    );

    throwIfAborted(signal);

    return {
      ...data,
      title_zh,
      plot_zh,
      actors: mappedActors,
      actor_profiles: mappedActorProfiles.length > 0 ? mappedActorProfiles : data.actor_profiles,
      genres: mappedGenres,
    };
  }

  private buildActorCacheKey(term: string): string {
    return normalizeTermKey(term);
  }

  private buildGenreCacheKey(term: string, target: LanguageTarget): string {
    return `${target}:${normalizeTermKey(term)}`;
  }

  private buildGenreTranslationPrompt(term: string, target: LanguageTarget): string {
    const targetLabel = getTargetLanguageLabel(target);

    return [
      `将以下影片类型标签翻译为${targetLabel}。`,
      "自动识别原文语言后翻译。",
      "翻译规则：",
      "1. 只输出一个简短的翻译结果。",
      "2. 对重复出现的术语保持译名一致。",
      "3. 不要输出解释或标点符号。",
      `术语：${term}`,
    ].join("\n");
  }

  private async normalizeActorAlias(term: string): Promise<string> {
    const normalized = term.trim();
    if (!normalized) {
      return "";
    }

    const cacheKey = this.buildActorCacheKey(normalized);

    return this.actorResolver.resolve(cacheKey, async () => {
      const actorCanonical = await findMappedActorName(normalized, "jp");
      const result = actorCanonical?.trim() || normalized;
      return result.length > 0 ? result : normalized;
    });
  }

  private async normalizeActorProfile(profile: ActorProfile): Promise<ActorProfile> {
    const originalName = profile.name.trim();
    if (!originalName) {
      return profile;
    }

    const normalizedName = await this.normalizeActorAlias(originalName);
    const nextName = normalizedName || originalName;
    const aliasCandidates = [originalName, ...(profile.aliases ?? [])]
      .map((alias) => alias.trim())
      .filter((alias) => alias.length > 0 && alias !== nextName);

    return {
      ...profile,
      name: nextName,
      aliases: aliasCandidates.length > 0 ? Array.from(new Set(aliasCandidates)) : profile.aliases,
    };
  }

  private async translateGenreTerm(
    term: string,
    target: LanguageTarget,
    config: Configuration,
    signal?: AbortSignal,
  ): Promise<string> {
    const normalized = term.trim();
    if (!normalized) {
      return "";
    }

    throwIfAborted(signal);

    const cacheKey = this.buildGenreCacheKey(normalized, target);

    return this.genreResolver.resolve(cacheKey, async () => {
      throwIfAborted(signal);
      const mapped = await findMappedGenreName(normalized, target);

      if (mapped) {
        return ensureTargetChinese(mapped.trim(), target);
      }

      const llmTerm = await this.translateGenreWithOpenAiTerm(normalized, target, config, signal);
      const translated = llmTerm ?? (await this.translateText(normalized, target, config, signal));
      const normalizedResult = ensureTargetChinese(translated.trim(), target);

      if (llmTerm) {
        try {
          await appendMappingCandidate({
            category: "genre",
            keyword: normalized,
            mapped: normalizedResult,
            target,
          });
        } catch (error) {
          this.logger.warn(`Failed to append translation mapping candidate: ${toErrorMessage(error)}`);
        }
      }

      return normalizedResult.length > 0 ? normalizedResult : normalized;
    });
  }

  private async translateGenreWithOpenAiTerm(
    term: string,
    target: LanguageTarget,
    config: Configuration,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (config.translate.engine === "google") {
      return null;
    }

    if (!config.translate.llmApiKey.trim()) {
      return null;
    }

    throwIfAborted(signal);

    const prompt = this.buildGenreTranslationPrompt(term, target);
    const client = this.openAiFactory(config);

    try {
      const response = await this.executeOpenAiRequestWithRetry(
        config,
        () => {
          return client.chat.completions.create(
            {
              model: config.translate.llmModelName,
              temperature: 0,
              messages: [
                {
                  role: "user",
                  content: prompt,
                },
              ],
            },
            { signal },
          );
        },
        signal,
      );

      const content = response.choices[0]?.message?.content;
      if (typeof content === "string" && content.trim().length > 0) {
        const firstLine = content
          .trim()
          .split(/\r?\n/gu)
          .find((line) => line.trim().length > 0);
        if (firstLine) {
          // Remove surrounding quotes (single, double, and curly quotes)
          const quotePattern = /^['\u0022\u201C\u201D]+|['\u0022\u201C\u201D]+$/gu;
          return firstLine.trim().replace(quotePattern, "");
        }
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      this.logger.warn(`OpenAI term translation failed: ${toErrorMessage(error)}`);
    }

    return null;
  }

  async translateText(
    input: string,
    target: LanguageTarget,
    config: Configuration,
    signal?: AbortSignal,
  ): Promise<string> {
    const text = normalizeNewlines(input).trim();
    if (!text) {
      return "";
    }

    throwIfAborted(signal);

    const detected = detectLanguage(text);
    if (detected === target) {
      return text;
    }

    if (detected === "zh_cn" || detected === "zh_tw") {
      return ensureTargetChinese(text, target);
    }

    const engine = config.translate.engine;

    if (engine === "google") {
      const google = await this.translateWithGoogle(text, target, signal);
      if (google) {
        return ensureTargetChinese(google.trim(), target);
      }
    } else {
      const openAi = await this.translateWithOpenAi(text, target, config, signal);
      if (openAi) {
        return ensureTargetChinese(openAi.trim(), target);
      }

      const google = await this.translateWithGoogle(text, target, signal);
      if (google) {
        return ensureTargetChinese(google.trim(), target);
      }
    }

    this.logger.warn(`All translation engines failed, returning original text`);
    return text;
  }

  private async translateWithOpenAi(
    text: string,
    target: LanguageTarget,
    config: Configuration,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (!config.translate.llmApiKey.trim()) {
      return null;
    }

    throwIfAborted(signal);

    const prompt = config.translate.llmPrompt
      .replaceAll("{lang}", getTargetLanguageLabel(target))
      .replaceAll("{content}", text);

    const client = this.openAiFactory(config);

    try {
      const response = await this.executeOpenAiRequestWithRetry(
        config,
        () => {
          return client.chat.completions.create(
            {
              model: config.translate.llmModelName,
              temperature: config.translate.llmTemperature,
              messages: [
                {
                  role: "user",
                  content: prompt,
                },
              ],
            },
            { signal },
          );
        },
        signal,
      );

      const content = response.choices[0]?.message?.content;
      if (typeof content === "string" && content.trim().length > 0) {
        return content.trim();
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      this.logger.warn(`OpenAI translation failed: ${toErrorMessage(error)}`);
    }

    return null;
  }

  private getOpenAiRequestsPerSecond(config: Configuration): number {
    const configured = Number(config.translate.llmMaxRequestsPerSecond);
    if (!Number.isFinite(configured)) {
      return 1;
    }

    return Math.max(1, Math.trunc(configured));
  }

  private getOpenAiQueue(config: Configuration): PQueue {
    const requestsPerSecond = this.getOpenAiRequestsPerSecond(config);
    const existing = this.openAiRequestQueues.get(requestsPerSecond);
    if (existing) {
      return existing;
    }

    const queue = new PQueue({
      concurrency: 1,
      interval: 1000,
      intervalCap: requestsPerSecond,
    });
    this.openAiRequestQueues.set(requestsPerSecond, queue);
    return queue;
  }

  private async executeOpenAiRequestWithRetry<T>(
    config: Configuration,
    request: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const maxRetryCount = Math.max(0, Math.trunc(config.translate.llmMaxRetries));
    let attempt = 0;

    while (true) {
      try {
        const queue = this.getOpenAiQueue(config);
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

        const retryAfterMs = this.getOpenAiRetryAfterDelayMs(error);
        if (retryAfterMs === null) {
          throw error;
        }

        attempt += 1;
        this.logger.warn(`OpenAI returned 429, retrying (${attempt}/${maxRetryCount}) after ${retryAfterMs}ms`);
        await sleep(retryAfterMs, undefined, signal ? { signal } : undefined);
      }
    }
  }

  private getOpenAiRetryAfterDelayMs(error: unknown): number | null {
    if (!error || typeof error !== "object") {
      return null;
    }

    const status = (error as { status?: unknown }).status;
    if (status !== OPENAI_RETRY_STATUS_CODE) {
      return null;
    }

    const headers =
      (error as { headers?: unknown }).headers ?? (error as { response?: { headers?: unknown } }).response?.headers;

    const rawRetryAfter = readRetryAfterHeader(headers);
    const parsed = parseRetryAfterMs(rawRetryAfter);
    if (parsed === null) {
      return null;
    }

    return Math.min(parsed, RETRY_AFTER_CAP_MS);
  }
  private async translateWithGoogle(
    text: string,
    target: LanguageTarget,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (!text.trim()) {
      return null;
    }

    throwIfAborted(signal);

    const tl = target === "zh_tw" ? "zh-TW" : "zh-CN";
    const url = new URL("https://translate.googleapis.com/translate_a/single");
    url.searchParams.set("client", "gtx");
    url.searchParams.set("sl", "auto");
    url.searchParams.set("tl", tl);
    url.searchParams.set("dt", "t");
    url.searchParams.set("q", text);

    try {
      const payload = await this.networkClient.getJson<unknown>(url.toString(), { signal });
      return extractGoogleTranslatedText(payload);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      this.logger.warn(`Google translate fallback failed: ${toErrorMessage(error)}`);
      return null;
    }
  }
}
