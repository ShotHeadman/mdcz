import type { Configuration } from "@mdcz/shared/config";
import type { CrawlerData, NfoLocalState } from "@mdcz/shared/types";
import { editedKeys, lockedKeys } from "./nfoEdits";
import type { SettledTranslations, TranslateService } from "./TranslateService";
import { normalizeNewlines } from "./translate/shared";

const sourceText = (value: string | undefined): string => normalizeNewlines(value ?? "").trim();

/**
 * Turns merged source-language metadata into what gets published. Locked fields keep the NFO's values, and so do
 * fields someone edited when `keepEdits` is set; maintenance previews leave it off to offer the site values instead.
 * The NFO doubles as the translation cache: an unchanged source keeps whichever translation it carries.
 */
export const publishMetadata = async (input: {
  data: CrawlerData;
  published?: { crawlerData?: CrawlerData; localState?: NfoLocalState };
  keepEdits: boolean;
  configuration: Configuration;
  translateService: Pick<TranslateService, "translateCrawlerData">;
  signal?: AbortSignal;
}): Promise<{ data: CrawlerData; error: string | null }> => {
  const published = input.published?.crawlerData;
  const edited = editedKeys(input.published?.localState);
  const kept = lockedKeys(input.published?.localState);
  if (input.keepEdits) for (const key of edited) kept.add(key);
  // The NFO's runtime was measured from the video; sites list rounded catalog runtimes that would never match it.
  const data = { ...input.data, durationSeconds: published?.durationSeconds ?? input.data.durationSeconds };
  for (const key of kept) Object.assign(data, { [key]: published?.[key] });

  const settled: SettledTranslations = {};
  for (const [field, translated] of [
    ["title", "title_zh"],
    ["plot", "plot_zh"],
  ] as const) {
    const source = sourceText(field === "title" ? (data.original_title ?? data.title) : data.plot);
    const publishedSource = sourceText(published?.[field]);
    const translation = published?.[translated]?.trim();
    // An edited title or plot is the user's text, not a cached translation of the source.
    if (kept.has(field) || (!edited.has(translated) && translation && source === publishedSource)) {
      settled[field] = translation && translation !== publishedSource ? translation : undefined;
    }
  }

  return await input.translateService.translateCrawlerData(data, input.configuration, input.signal, settled, kept);
};
