import { z } from "zod";
import type { RuntimeNetworkClient } from "../../../network";
import { throwIfAborted } from "../../utils/abort";
import type { MachineTranslator } from "../types";

const responseSchema = z.object({ translations: z.array(z.object({ text: z.string().trim().min(1) })) });

export const isOfficialDeeplUrl = (url: string): boolean =>
  !url.trim() || ["api.deepl.com", "api-free.deepl.com"].includes(new URL(url).hostname);

export class DeeplTranslator {
  constructor(private readonly networkClient: RuntimeNetworkClient) {}

  readonly translate: MachineTranslator = async (texts, target, config, signal) => {
    if (!texts.length) return [];
    const key = config.translate.deeplApiKey.trim();
    const customUrl = config.translate.deeplApiUrl.trim();
    const url =
      customUrl ||
      (key.endsWith(":fx") ? "https://api-free.deepl.com/v2/translate" : "https://api.deepl.com/v2/translate");
    const official = isOfficialDeeplUrl(url);
    if (official && !key) throw new Error("DeepL translation requires an API key");
    const init = { signal, headers: key ? { Authorization: `DeepL-Auth-Key ${key}` } : undefined };
    const target_lang = target === "zh_tw" ? "ZH-HANT" : "ZH-HANS";
    const results: string[] = [];
    // DeepLX merges arrays into one result, so custom endpoints receive one field at a time.
    const batchSize = official ? 50 : 1;
    for (let offset = 0; offset < texts.length; offset += batchSize) {
      throwIfAborted(signal);
      const batch = texts.slice(offset, offset + batchSize);
      const body = { text: batch, target_lang };
      const payload = responseSchema.parse(await this.networkClient.postJson(url, body, init));
      if (payload.translations.length !== batch.length) throw new Error("DeepL translation result count mismatch");
      results.push(...payload.translations.map((translation) => translation.text));
    }
    return results;
  };
}
