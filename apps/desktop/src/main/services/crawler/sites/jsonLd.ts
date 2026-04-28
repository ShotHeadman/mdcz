import type { CheerioAPI } from "cheerio";

export type JsonLdRecord = Record<string, unknown>;

const toRecord = (value: unknown): JsonLdRecord | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonLdRecord;
};

const unpackGraphRecords = (record: JsonLdRecord): JsonLdRecord[] => {
  const graph = record["@graph"];
  if (!Array.isArray(graph)) {
    return [record];
  }

  const fromGraph = graph.map((entry) => toRecord(entry)).filter((entry): entry is JsonLdRecord => Boolean(entry));
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
        const normalized = toRecord(record);
        if (!normalized) {
          continue;
        }

        const candidate = unpackGraphRecords(normalized)[0];
        if (candidate) {
          return candidate as T;
        }
      }
    } catch {}
  }

  return null;
};
