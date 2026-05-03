import type { Configuration } from "@mdcz/shared/config";
import type { CrawlerData } from "@mdcz/shared/types";
import type { RuntimeNetworkClient, RuntimeRequestInit } from "../network";
import { detectLanguage, noopRuntimeLogger, type RuntimeLogger } from "../shared";
import { ActorNameNormalizer } from "./translate/ActorNameNormalizer";
import { GoogleTranslator } from "./translate/engines/GoogleTranslator";
import { LlmApiClient, type RuntimeNetworkJsonResponse } from "./translate/engines/LlmApiClient";
import { OpenAiTranslator } from "./translate/engines/OpenAiTranslator";
import { GenreTranslator } from "./translate/GenreTranslator";
import { ensureTargetChinese, normalizeNewlines, toTranslatedFieldValue } from "./translate/shared";
import { type LanguageTarget, type TranslationMappingStore, toTarget } from "./translate/types";
import { throwIfAborted } from "./utils/abort";

export interface TranslateServiceOptions {
  logger?: RuntimeLogger;
  llmApiClient?: LlmApiClient;
  mappingStore?: TranslationMappingStore;
}

const isLlmApiClientLike = (value: unknown): value is LlmApiClient =>
  typeof value === "object" && value !== null && "generateText" in value && typeof value.generateText === "function";

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

  private readonly googleTranslator: GoogleTranslator;

  private readonly genreTranslator: GenreTranslator;

  constructor(
    private readonly networkClient: RuntimeNetworkClient,
    options: TranslateServiceOptions | LlmApiClient = {},
  ) {
    const resolvedOptions = isLlmApiClientLike(options) ? { llmApiClient: options } : options;
    this.logger = resolvedOptions.logger ?? noopRuntimeLogger;
    this.actorNameNormalizer = new ActorNameNormalizer(resolvedOptions.mappingStore);
    const llmApiClient = resolvedOptions.llmApiClient ?? createLlmApiClient(networkClient);
    this.openAiTranslator = new OpenAiTranslator(this.logger, llmApiClient);
    this.googleTranslator = new GoogleTranslator(this.networkClient, this.logger);
    this.genreTranslator = new GenreTranslator(this.logger, this.openAiTranslator, resolvedOptions.mappingStore);
  }

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

    const mappedActors = await Promise.all(
      (data.actors ?? []).map((actor) => this.actorNameNormalizer.normalizeAlias(actor)),
    );
    const mappedActorProfiles = await Promise.all(
      (data.actor_profiles ?? []).map((profile) => this.actorNameNormalizer.normalizeProfile(profile)),
    );
    const mappedGenres = await Promise.all(
      (data.genres ?? []).map((genre) =>
        this.genreTranslator.translateTerm(genre, target, config, this.translateText.bind(this), signal),
      ),
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
      const google = await this.googleTranslator.translateText(text, target, signal);
      if (google) {
        return ensureTargetChinese(google.trim(), target);
      }
    } else {
      const openAi = await this.openAiTranslator.translateText(text, target, config, signal);
      if (openAi) {
        return ensureTargetChinese(openAi.trim(), target);
      }
    }

    this.logger.warn("Translation engine failed, returning original text");
    return text;
  }
}
