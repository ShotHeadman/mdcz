import { z } from "zod";
import type { RuntimeNetworkClient } from "../../../network";
import { getScrapeConcurrency } from "../../executionPolicy";
import { throwIfAborted } from "../../utils/abort";
import type { MachineTranslator } from "../types";

const googleTranslateResponseSchema = z.array(z.unknown());

const splitLines = (text: string): string[] =>
  text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

const extractGoogleTranslatedText = (payload: unknown): string | null => {
  const parsed = googleTranslateResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }

  const first = parsed.data[0];
  if (!Array.isArray(first)) {
    return null;
  }

  const segments: string[] = [];
  for (const segment of first) {
    if (Array.isArray(segment) && typeof segment[0] === "string") {
      segments.push(segment[0]);
    }
  }

  const result = segments.join("");
  return result.trim().length > 0 ? result : null;
};

export class GoogleTranslator {
  constructor(private readonly networkClient: RuntimeNetworkClient) {}

  readonly translate: MachineTranslator = async (texts, target, config, signal) => {
    const lines = texts.map(splitLines);
    const batch = lines.flat();
    if (!batch.length) return texts.map(() => null);

    throwIfAborted(signal);
    this.networkClient.setDomainLimit?.("translate.googleapis.com", 5, getScrapeConcurrency(config));

    const url = new URL("https://translate.googleapis.com/translate_a/single");
    url.searchParams.set("client", "gtx");
    url.searchParams.set("sl", "auto");
    url.searchParams.set("tl", target === "zh_tw" ? "zh-TW" : "zh-CN");
    url.searchParams.set("dt", "t");
    url.searchParams.set("q", batch.join("\n"));

    const translated = extractGoogleTranslatedText(
      await this.networkClient.getJson<unknown>(url.toString(), { signal }),
    );
    const results = splitLines(translated ?? "");
    if (results.length !== batch.length) {
      throw new Error("Google translation result count mismatch");
    }

    let offset = 0;
    return lines.map((textLines) => {
      if (!textLines.length) return null;
      const result = results.slice(offset, offset + textLines.length).join("\n");
      offset += textLines.length;
      return result || null;
    });
  };
}
