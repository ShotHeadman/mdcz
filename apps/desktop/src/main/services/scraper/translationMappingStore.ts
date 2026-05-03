import { appendMappingCandidate, findMappedActorName, findMappedGenreName } from "@main/utils/translate";
import type { TranslationMappingStore } from "@mdcz/runtime/scrape";

export const translationMappingStore: TranslationMappingStore = {
  appendMappingCandidate,
  findMappedActorName,
  findMappedGenreName,
};
