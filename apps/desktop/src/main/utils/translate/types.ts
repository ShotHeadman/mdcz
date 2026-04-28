export type LanguageTarget = "zh_cn" | "zh_tw" | "jp";
export type MappingCandidateCategory = "actor" | "genre";
export type CandidateLanguageTarget = Exclude<LanguageTarget, "jp">;

export interface MappingEntry {
  zh_cn: string;
  zh_tw: string;
  jp: string;
  keywords: string[];
}

export interface JsonMappingRow {
  canonical?: string;
  aliases?: string[] | string;
  zh_cn?: string;
  zh_tw?: string;
  jp?: string;
  keyword?: string;
  keywords?: string[] | string;
}

export interface JsonMappingRoot {
  entries?: JsonMappingRow[];
}

export interface JsonMappingDocument extends JsonMappingRoot {
  version?: number;
  source?: string;
}

export interface MappingCandidateRecord {
  category: MappingCandidateCategory;
  keyword: string;
  normalizedKeyword: string;
  mapped: string;
  target: CandidateLanguageTarget;
  source: "llm";
  createdAt: string;
}
