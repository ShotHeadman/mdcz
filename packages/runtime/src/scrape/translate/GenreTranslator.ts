import { detectLanguage } from "../../shared";
import { throwIfAborted } from "../utils/abort";
import { ensureTargetChinese, normalizeTermKey } from "./shared";
import type { LanguageTarget, TranslationMappingStore } from "./types";

export class GenreTranslator {
  private readonly cache = new Map<string, string>();

  constructor(private readonly mappingStore?: TranslationMappingStore) {}

  async resolve(terms: string[], target: LanguageTarget, signal?: AbortSignal) {
    throwIfAborted(signal);

    const normalizedTerms = terms.map((term) => term.trim());
    const resolvedByKey = new Map<string, string>();
    const unresolvedByKey = new Map<string, string>();

    for (const term of normalizedTerms) {
      if (!term) continue;
      const key = `${target}:${normalizeTermKey(term)}`;
      const cached = this.cache.get(key);
      if (cached !== undefined) {
        resolvedByKey.set(key, cached);
        continue;
      }
      if (unresolvedByKey.has(key)) continue;

      const mapped =
        (await this.mappingStore?.findMappedGenreName(term, target)) ?? (detectLanguage(term) === "zh" ? term : null);
      if (mapped !== null) {
        const normalized = ensureTargetChinese(mapped.trim(), target);
        this.cache.set(key, normalized);
        resolvedByKey.set(key, normalized);
      } else {
        unresolvedByKey.set(key, term);
      }
    }

    return { normalizedTerms, resolvedByKey, unresolvedEntries: [...unresolvedByKey.entries()] };
  }

  remember(
    state: Awaited<ReturnType<GenreTranslator["resolve"]>>,
    translated: Array<string | null>,
    target: LanguageTarget,
  ): string[] {
    const { normalizedTerms, resolvedByKey, unresolvedEntries } = state;
    if (translated.length === unresolvedEntries.length) {
      unresolvedEntries.forEach(([key, term], index) => {
        const value = translated[index]?.trim();
        if (!value || value === term) return;
        const normalized = ensureTargetChinese(value, target);
        this.cache.set(key, normalized);
        resolvedByKey.set(key, normalized);
      });
    }

    return normalizedTerms.flatMap((term) => {
      if (!term) return [];
      const translated = resolvedByKey.get(`${target}:${normalizeTermKey(term)}`) ?? term;
      return translated ? [translated] : [];
    });
  }
}
