import type { Configuration } from "@mdcz/shared/config";
import type { TranslateEngine } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import {
  isUnrecoverableNetworkError,
  type RuntimeNetworkClient,
  type RuntimeRequestInit,
  runWithNetworkChannel,
} from "../network";
import { detectLanguage, noopRuntimeLogger, type RuntimeLogger, toErrorMessage } from "../shared";
import { ActorNameNormalizer } from "./translate/ActorNameNormalizer";
import { BaiduTranslator } from "./translate/engines/BaiduTranslator";
import { DeeplTranslator } from "./translate/engines/DeeplTranslator";
import { GoogleTranslator } from "./translate/engines/GoogleTranslator";
import { LlmApiClient, type RuntimeNetworkJsonResponse } from "./translate/engines/LlmApiClient";
import { type LlmMetadataTranslationInput, OpenAiTranslator } from "./translate/engines/OpenAiTranslator";
import { GenreTranslator } from "./translate/GenreTranslator";
import { ensureTargetChinese, normalizeNewlines } from "./translate/shared";
import { type LanguageTarget, type MachineTranslator, type TranslationMappingStore, toTarget } from "./translate/types";
import { isAbortError, throwIfAborted } from "./utils/abort";

export interface TranslateServiceOptions {
  logger?: RuntimeLogger;
  llmApiClient?: LlmApiClient;
  mappingStore?: TranslationMappingStore;
}

const createLlmApiClient = (networkClient: RuntimeNetworkClient): LlmApiClient => {
  const postJsonDetailed = networkClient.postJsonDetailed;
  if (typeof postJsonDetailed === "function") {
    return new LlmApiClient({
      postJsonDetailed: async <TResponse>(url: string, payload: unknown, init?: RuntimeRequestInit) => {
        const response = await postJsonDetailed.call(networkClient, url, payload, init);
        return response as RuntimeNetworkJsonResponse<TResponse>;
      },
    });
  }

  return new LlmApiClient();
};

export class TranslateService {
  private readonly logger: RuntimeLogger;

  private readonly actorNameNormalizer: ActorNameNormalizer;

  private readonly openAiTranslator: OpenAiTranslator;

  private readonly translators: Record<Exclude<TranslateEngine, "openai">, MachineTranslator>;

  private readonly genreTranslator: GenreTranslator;

  constructor(networkClient: RuntimeNetworkClient, options: TranslateServiceOptions = {}) {
    this.logger = options.logger ?? noopRuntimeLogger;
    this.actorNameNormalizer = new ActorNameNormalizer(options.mappingStore);
    const llmApiClient = options.llmApiClient ?? createLlmApiClient(networkClient);
    this.openAiTranslator = new OpenAiTranslator(this.logger, llmApiClient);
    this.translators = {
      google: new GoogleTranslator(networkClient).translate,
      deepl: new DeeplTranslator(networkClient).translate,
      baidu: new BaiduTranslator(networkClient).translate,
    };
    this.genreTranslator = new GenreTranslator(options.mappingStore);
  }

  async translateCrawlerData(
    data: CrawlerData,
    config: Configuration,
    signal?: AbortSignal,
  ): Promise<{ data: CrawlerData; error: string | null }> {
    if (!config.translate.enableTranslation) {
      return { data, error: null };
    }

    throwIfAborted(signal);

    const target = toTarget(config.translate.targetLanguage);
    const startedAt = Date.now();
    this.logger.info(
      `[translation] number=${data.number} engine=${config.translate.engine} target=${target} model=${config.translate.engine === "openai" ? config.translate.llmModelName : "none"} reasoning=${config.translate.engine === "openai" ? config.translate.llmReasoning : "none"} titleChars=${data.title.length} plotChars=${data.plot?.length ?? 0} genres=${data.genres?.length ?? 0}`,
    );

    const mappedActors = await Promise.all(
      (data.actors ?? []).map((actor) => this.actorNameNormalizer.normalizeAlias(actor)),
    );
    const mappedActorProfiles = await Promise.all(
      (data.actor_profiles ?? []).map((profile) => this.actorNameNormalizer.normalizeProfile(profile)),
    );
    const prepareField = (input: string | undefined): { source: string | null; translated: string | undefined } => {
      const text = normalizeNewlines(input ?? "").trim();
      if (!text) return { source: null, translated: undefined };
      if (detectLanguage(text) === "zh") return { source: null, translated: ensureTargetChinese(text, target) };
      return { source: text, translated: undefined };
    };
    const fields = { title: prepareField(data.title), plot: prepareField(data.plot) };
    const genres = await this.genreTranslator.resolve(data.genres ?? [], target, signal);
    let metadataTranslation: Awaited<ReturnType<TranslateService["translateMetadata"]>> | null = null;
    let translationError: string | null = null;
    try {
      metadataTranslation = await this.translateMetadata(
        {
          title: fields.title.source,
          plot: fields.plot.source,
          genres: genres.unresolvedEntries.map(([, term]) => term),
        },
        target,
        config,
        signal,
      );
    } catch (error) {
      if (isAbortError(error) || isUnrecoverableNetworkError(error)) throw error;
      translationError = toErrorMessage(error);
      this.logger.warn(`Translation failed for ${data.number}: ${translationError}`);
    }
    const mappedGenres = this.genreTranslator.remember(genres, metadataTranslation?.genres ?? [], target);

    for (const field of ["title", "plot"] as const) {
      const prepared = fields[field];
      if (!prepared.source || !metadataTranslation) continue;
      const returned = normalizeNewlines(metadataTranslation[field] ?? "").trim();
      if (returned && returned !== prepared.source) {
        prepared.translated = ensureTargetChinese(returned, target);
        continue;
      }
      const message = `Translation engine failed for ${field} (${data.number}), returning original text: ${returned ? "source echoed" : "engine returned no translation"}`;
      this.logger.warn(message);
      translationError = translationError ? `${translationError}; ${message}` : message;
    }

    throwIfAborted(signal);
    const title_zh = fields.title.translated;
    const plot_zh = fields.plot.translated;
    this.logger.info(
      `[translation] number=${data.number} durationMs=${Date.now() - startedAt} title=${title_zh ? "accepted" : "original"} plot=${!data.plot ? "absent" : plot_zh ? "accepted" : "original"} genresIn=${data.genres?.length ?? 0} genresOut=${mappedGenres.length} genresWithKana=${mappedGenres.filter((genre) => detectLanguage(genre) === "jp").length}`,
    );

    return {
      data: {
        ...data,
        title_zh,
        plot_zh,
        actors: mappedActors,
        actor_profiles: mappedActorProfiles.length > 0 ? mappedActorProfiles : data.actor_profiles,
        genres: mappedGenres,
      },
      error: translationError,
    };
  }

  async translateMetadata(
    input: LlmMetadataTranslationInput,
    target: LanguageTarget,
    config: Configuration,
    signal?: AbortSignal,
  ): Promise<{ title: string | null; plot: string | null; genres: Array<string | null> }> {
    throwIfAborted(signal);
    return await runWithNetworkChannel("translation", async () => {
      if (config.translate.engine === "openai") {
        return await this.openAiTranslator.translateMetadata(input, target, config, signal);
      }
      const sources = [input.title, input.plot].filter((text): text is string => text !== null);
      const translated = await this.translators[config.translate.engine](
        [...sources, ...input.genres],
        target,
        config,
        signal,
      );
      let index = 0;
      return {
        title: input.title !== null ? (translated[index++] ?? null) : null,
        plot: input.plot !== null ? (translated[index++] ?? null) : null,
        genres: translated.slice(index),
      };
    });
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

    if (detectLanguage(text) === "zh") return ensureTargetChinese(text, target);

    const engine = config.translate.engine;

    const translated = await runWithNetworkChannel("translation", () =>
      engine === "openai"
        ? this.openAiTranslator.translateText(text, target, config, signal)
        : this.translators[engine]([text], target, config, signal).then((results) => results[0]),
    );
    if (translated?.trim() && translated.trim() !== text) return ensureTargetChinese(translated.trim(), target);

    this.logger.warn(`Translation engine ${engine} returned no translated text; returning original text`);
    return text;
  }
}
