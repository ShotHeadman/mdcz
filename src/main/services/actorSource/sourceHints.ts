import { normalizeText } from "@main/utils/normalization";
import type { ActorSourceHint } from "./types";

const normalizeHintValue = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = normalizeText(value);
  return normalized || undefined;
};

const normalizeHint = (hint: ActorSourceHint): ActorSourceHint | null => {
  const normalized: ActorSourceHint = {
    website: hint.website,
    agency: normalizeHintValue(hint.agency),
    studio: normalizeHintValue(hint.studio),
    publisher: normalizeHintValue(hint.publisher),
    sourceUrl: normalizeHintValue(hint.sourceUrl),
  };

  return normalized.website || normalized.agency || normalized.studio || normalized.publisher || normalized.sourceUrl
    ? normalized
    : null;
};

export const mergeActorSourceHints = (...groups: Array<ActorSourceHint[] | undefined>): ActorSourceHint[] => {
  const seen = new Set<string>();
  const merged: ActorSourceHint[] = [];

  for (const group of groups) {
    for (const hint of group ?? []) {
      const normalized = normalizeHint(hint);
      if (!normalized) {
        continue;
      }

      const key = JSON.stringify(normalized);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      merged.push(normalized);
    }
  }

  return merged;
};
