import type { Configuration } from "@mdcz/shared/config";
import { CachedAsyncResolver, toErrorMessage } from "../../shared";
import { throwIfAborted } from "../utils/abort";
import type { OpenAiTranslator } from "./engines/OpenAiTranslator";
import { ensureTargetChinese, getTargetLanguageLabel, normalizeTermKey } from "./shared";
import type { LanguageTarget, TranslationMappingStore } from "./types";

interface TranslationLogger {
  warn(message: string): void;
}

type TranslateTextFn = (
  input: string,
  target: LanguageTarget,
  config: Configuration,
  signal?: AbortSignal,
) => Promise<string>;

export class GenreTranslator {
  private readonly genreResolver = new CachedAsyncResolver<string, string>();

  constructor(
    private readonly logger: TranslationLogger,
    private readonly openAiTranslator: OpenAiTranslator,
    private readonly mappingStore?: TranslationMappingStore,
  ) {}

  async translateTerm(
    term: string,
    target: LanguageTarget,
    config: Configuration,
    translateText: TranslateTextFn,
    signal?: AbortSignal,
  ): Promise<string> {
    const normalized = term.trim();
    if (!normalized) {
      return "";
    }

    throwIfAborted(signal);

    const cacheKey = `${target}:${normalizeTermKey(normalized)}`;

    return this.genreResolver.resolve(cacheKey, async () => {
      throwIfAborted(signal);
      const mapped = await this.mappingStore?.findMappedGenreName(normalized, target);

      if (mapped) {
        return ensureTargetChinese(mapped.trim(), target);
      }

      const translated =
        config.translate.engine === "google"
          ? await translateText(normalized, target, config, signal)
          : await this.translateWithOpenAi(normalized, target, config, signal);
      if (!translated) {
        return normalized;
      }

      const normalizedResult = ensureTargetChinese(translated.trim(), target);

      if (config.translate.engine !== "google") {
        try {
          await this.mappingStore?.appendMappingCandidate({
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

  private buildPrompt(term: string, target: LanguageTarget): string {
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

  private async translateWithOpenAi(
    term: string,
    target: LanguageTarget,
    config: Configuration,
    signal?: AbortSignal,
  ): Promise<string | null> {
    return await this.openAiTranslator.translateSingleLine(this.buildPrompt(term, target), config, signal);
  }
}
