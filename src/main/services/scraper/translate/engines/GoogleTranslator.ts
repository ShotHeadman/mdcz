import type { NetworkClient } from "@main/services/network";
import { toErrorMessage } from "@main/utils/common";
import { z } from "zod";
import { isAbortError, throwIfAborted } from "../../abort";
import type { LanguageTarget } from "../types";

interface TranslationLogger {
  warn(message: string): void;
}

const googleTranslateResponseSchema = z.array(z.unknown());

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

export class GoogleTranslator {
  constructor(
    private readonly networkClient: NetworkClient,
    private readonly logger: TranslationLogger,
  ) {}

  async translateText(text: string, target: LanguageTarget, signal?: AbortSignal): Promise<string | null> {
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
