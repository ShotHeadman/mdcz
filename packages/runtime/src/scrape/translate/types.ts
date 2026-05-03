import type { TranslationTarget } from "@mdcz/shared/enums";

export type LanguageTarget = "zh_cn" | "zh_tw";
export type ActorMappingLanguageTarget = LanguageTarget | "jp";
export type MappingCandidateCategory = "actor" | "genre";

export interface TranslationMappingStore {
  findMappedActorName(value: string, language?: ActorMappingLanguageTarget): Promise<string | null>;
  findMappedGenreName(value: string, language?: LanguageTarget): Promise<string | null>;
  appendMappingCandidate(input: {
    category: MappingCandidateCategory;
    keyword: string;
    mapped: string;
    target: LanguageTarget;
  }): Promise<void>;
}

export const toTarget = (value: TranslationTarget): LanguageTarget => {
  if (value === "zh-TW") {
    return "zh_tw";
  }
  return "zh_cn";
};
