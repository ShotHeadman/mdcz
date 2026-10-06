import { isRecord, normalizeText, uniqueStrings } from "@mdcz/runtime/shared";
import type { CheerioAPI } from "cheerio";

export type JsonLdRecord = Record<string, unknown>;

const unpackGraphRecords = (record: JsonLdRecord): JsonLdRecord[] => {
  const graph = record["@graph"];
  if (!Array.isArray(graph)) {
    return [record];
  }

  const fromGraph = graph.filter(isRecord);
  return fromGraph.length > 0 ? fromGraph : [record];
};

export const readFirstJsonLdRecord = <T extends JsonLdRecord = JsonLdRecord>($: CheerioAPI): T | null => {
  const scripts = $("script[type='application/ld+json']").toArray();

  for (const script of scripts) {
    const text = $(script).text().trim();
    if (!text) {
      continue;
    }

    try {
      const parsed = JSON.parse(text) as unknown;
      const records = Array.isArray(parsed) ? parsed : [parsed];

      for (const record of records) {
        if (!isRecord(record)) {
          continue;
        }

        const candidate = unpackGraphRecords(record)[0];
        if (candidate) {
          return candidate as T;
        }
      }
    } catch {}
  }

  return null;
};

export const parseIsoDurationToSeconds = (value: unknown): number | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const matched = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/iu);
  if (!matched) {
    return undefined;
  }

  const hours = Number.parseInt(matched[1] ?? "0", 10);
  const minutes = Number.parseInt(matched[2] ?? "0", 10);
  const seconds = Number.parseInt(matched[3] ?? "0", 10);
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : undefined;
};

/** Actor names from a JSON-LD `actor` value, which may be a name, a Person, or a list of either. */
export const readJsonLdActors = (value: unknown): string[] =>
  uniqueStrings(
    (Array.isArray(value) ? value : [value]).map((actor) => {
      const name = isRecord(actor) ? actor.name : actor;
      return typeof name === "string" ? normalizeText(name) : undefined;
    }),
  );
