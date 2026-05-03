import { stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { Configuration } from "@mdcz/shared/config";
import type { BatchTranslateApplyResultItem, BatchTranslateField, BatchTranslateScanItem } from "@mdcz/shared/ipcTypes";
import type { CrawlerData, FileInfo, LocalScanEntry, NfoLocalState } from "@mdcz/shared/types";
import {
  ensureTargetChinese,
  getTargetLanguageLabel,
  isMissingRequiredLlmApiKey,
  type LanguageTarget,
  type LlmApiClient,
  normalizeLlmBaseUrl,
  normalizeNewlines,
  toTarget,
} from "../scrape";
import { NfoGenerator } from "../scrape/nfo";
import type { RuntimeLogger } from "../shared";
import { detectLanguage, toErrorMessage } from "../shared";

type BatchTranslateLocalScanService = {
  scan(dirPath: string, sceneImagesFolder: string): Promise<LocalScanEntry[]>;
  scanVideo(videoPath: string, sceneImagesFolder: string): Promise<LocalScanEntry>;
};

type BatchTranslateWriteNfoInput = {
  assets: {
    downloaded: string[];
    sceneImages: string[];
  };
  config: {
    download: Configuration["download"];
    naming: Configuration["naming"];
  };
  crawlerData: CrawlerData;
  enabled: boolean;
  fileInfo: FileInfo;
  localState?: NfoLocalState;
  logger: RuntimeLogger;
  nfoGenerator: NfoGenerator;
  nfoPath: string;
  sourceVideoPath: string;
};

export type BatchTranslateWriteNfo = (input: BatchTranslateWriteNfoInput) => Promise<string | undefined>;

type BatchTranslationAction =
  | { field: BatchTranslateField; mode: "translate"; text: string; key: string }
  | { field: BatchTranslateField; mode: "convert"; value: string };

type BatchTranslationPlanItem = {
  entry: LocalScanEntry;
  titleAction?: BatchTranslationAction;
  plotAction?: BatchTranslationAction;
};

type PendingTranslation = {
  key: string;
  text: string;
};

export interface BatchNfoTranslatorDependencies {
  localScanService?: BatchTranslateLocalScanService;
  llmApiClient?: Pick<LlmApiClient, "generateText">;
  nfoGenerator?: NfoGenerator;
  writeNfo?: BatchTranslateWriteNfo;
  logger?: RuntimeLogger;
}

const MAX_BATCH_ITEMS = 20;
const MAX_BATCH_CHARS = 12_000;
const CODE_FENCE_PATTERN = /^```(?:json)?\s*|\s*```$/giu;
const MOVIE_NFO_NAME = "movie.nfo";

const noopLogger: RuntimeLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const normalizeText = (value: string | undefined): string => normalizeNewlines(value ?? "").trim();

const parseJsonStringArray = (content: string, expectedLength: number): string[] | null => {
  const parseCandidate = (candidate: string): string[] | null => {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!Array.isArray(parsed) || parsed.length !== expectedLength) return null;

      const outputs: string[] = [];
      for (const item of parsed) {
        if (typeof item !== "string") return null;
        outputs.push(item);
      }
      return outputs;
    } catch {
      return null;
    }
  };

  const candidates = new Set<string>();
  const trimmed = content.trim();
  if (trimmed) {
    candidates.add(trimmed);
    candidates.add(trimmed.replace(CODE_FENCE_PATTERN, "").trim());
  }

  for (const candidate of [...candidates]) {
    const start = candidate.indexOf("[");
    const end = candidate.lastIndexOf("]");
    if (start >= 0 && end > start) candidates.add(candidate.slice(start, end + 1).trim());
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = parseCandidate(candidate);
    if (parsed) return parsed;
  }

  return null;
};

const buildBatchChunks = (items: PendingTranslation[]): PendingTranslation[][] => {
  const chunks: PendingTranslation[][] = [];
  let currentChunk: PendingTranslation[] = [];
  let currentChars = 0;

  for (const item of items) {
    const itemChars = item.text.length;
    const shouldFlush =
      currentChunk.length > 0 && (currentChunk.length >= MAX_BATCH_ITEMS || currentChars + itemChars > MAX_BATCH_CHARS);

    if (shouldFlush) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentChars = 0;
    }

    currentChunk.push(item);
    currentChars += itemChars;
  }

  if (currentChunk.length > 0) chunks.push(currentChunk);
  return chunks;
};

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    return (await stat(targetPath)).isFile();
  } catch {
    return false;
  }
};

const resolveExistingNfoNaming = async (nfoPath: string): Promise<Configuration["download"]["nfoNaming"]> => {
  const normalizedNfoPath = resolve(nfoPath);
  if (basename(normalizedNfoPath).toLowerCase() === MOVIE_NFO_NAME) return "movie";

  const moviePath = join(dirname(normalizedNfoPath), MOVIE_NFO_NAME);
  return (await pathExists(moviePath)) ? "both" : "filename";
};

const defaultWriteNfo: BatchTranslateWriteNfo = async ({ config, crawlerData, nfoGenerator, nfoPath }) => {
  return await nfoGenerator.writeNfo(nfoPath, crawlerData, {
    nfoNaming: config.download.nfoNaming,
    nfoTitleTemplate: config.naming.nfoTitleTemplate,
  });
};

const buildFieldAction = (
  field: BatchTranslateField,
  sourceValue: string | undefined,
  currentValue: string | undefined,
  target: LanguageTarget,
): BatchTranslationAction | undefined => {
  const source = normalizeText(sourceValue);
  const current = normalizeText(currentValue) || source;
  if (!current) return undefined;

  const currentLanguage = detectLanguage(current);
  if (currentLanguage === target) return undefined;

  if (currentLanguage === "zh_cn" || currentLanguage === "zh_tw") {
    return {
      field,
      mode: "convert",
      value: ensureTargetChinese(current, target),
    };
  }

  return {
    field,
    mode: "translate",
    text: source || current,
    key: `${target}:${source || current}`,
  };
};

const toScanItem = (entry: LocalScanEntry, target: LanguageTarget): BatchTranslateScanItem | null => {
  if (!entry.nfoPath || !entry.crawlerData) return null;

  const pendingFields: BatchTranslateField[] = [];
  if (buildFieldAction("title", entry.crawlerData.title, entry.crawlerData.title_zh, target))
    pendingFields.push("title");
  if (buildFieldAction("plot", entry.crawlerData.plot, entry.crawlerData.plot_zh, target)) pendingFields.push("plot");
  if (pendingFields.length === 0) return null;

  return {
    filePath: entry.fileInfo.filePath,
    nfoPath: entry.nfoPath,
    directory: entry.currentDir,
    number: entry.crawlerData.number || entry.fileInfo.number,
    title: entry.crawlerData.title_zh?.trim() || entry.crawlerData.title,
    pendingFields,
  };
};

const buildBatchPrompt = (texts: string[], target: LanguageTarget): string => {
  const targetLabel = getTargetLanguageLabel(target);

  return [
    `将输入 JSON 数组中的每一项翻译为${targetLabel}。`,
    "规则：",
    `1. 只返回一个 JSON 字符串数组，长度必须为 ${texts.length}。`,
    "2. 返回数组的顺序必须与输入数组完全一致。",
    "3. 每个元素只包含最终翻译文本，不要输出解释、代码块、Markdown、编号或额外字段。",
    "4. 自动识别原文语言；如果原文已经是目标中文，直接返回合适的中文结果。",
    "输入 JSON：",
    JSON.stringify(texts),
  ].join("\n");
};

const assertLlmConfiguration = (config: Configuration): void => {
  const model = config.translate.llmModelName.trim();
  const apiKey = config.translate.llmApiKey.trim();
  const baseUrl = normalizeLlmBaseUrl(config.translate.llmBaseUrl);

  if (!model) throw new Error("请先配置 LLM 模型名称");
  if (isMissingRequiredLlmApiKey(baseUrl, apiKey)) throw new Error("请先配置 LLM API Key");
};

const translateChunk = async (
  llmApiClient: Pick<LlmApiClient, "generateText">,
  texts: string[],
  target: LanguageTarget,
  config: Configuration,
): Promise<string[]> => {
  const content = await llmApiClient.generateText(
    {
      model: config.translate.llmModelName,
      apiKey: config.translate.llmApiKey,
      baseUrl: config.translate.llmBaseUrl,
      temperature: 0,
      prompt: buildBatchPrompt(texts, target),
    },
    undefined,
  );

  if (!content) throw new Error("LLM 返回空响应");
  const parsed = parseJsonStringArray(content, texts.length);
  if (!parsed) throw new Error("LLM 返回的批量翻译结果不是有效 JSON 数组");
  return parsed;
};

const translatePendingTexts = async (
  llmApiClient: Pick<LlmApiClient, "generateText">,
  items: PendingTranslation[],
  target: LanguageTarget,
  config: Configuration,
  logger: RuntimeLogger,
): Promise<Map<string, string>> => {
  const translatedByKey = new Map<string, string>();

  for (const chunk of buildBatchChunks(items)) {
    try {
      const translated = await translateChunk(
        llmApiClient,
        chunk.map((item) => item.text),
        target,
        config,
      );
      chunk.forEach((item, index) => {
        const value = translated[index]?.trim();
        if (value) translatedByKey.set(item.key, ensureTargetChinese(value, target));
      });
    } catch (error) {
      logger.warn(`Batch translation chunk failed: ${toErrorMessage(error)}`);
    }
  }

  return translatedByKey;
};

export const scanBatchNfoTranslations = async (
  directory: string,
  config: Configuration,
  dependencies: BatchNfoTranslatorDependencies = {},
): Promise<BatchTranslateScanItem[]> => {
  if (!dependencies.localScanService) {
    throw new Error("Batch NFO translation scan requires a localScanService dependency");
  }

  const target = toTarget(config.translate.targetLanguage);
  const entries = await dependencies.localScanService.scan(resolve(directory.trim()), config.paths.sceneImagesFolder);
  return entries
    .map((entry) => toScanItem(entry, target))
    .filter((item): item is BatchTranslateScanItem => item !== null)
    .sort((left, right) => left.nfoPath.localeCompare(right.nfoPath, "zh-CN"));
};

export const applyBatchNfoTranslations = async (
  items: BatchTranslateScanItem[],
  config: Configuration,
  dependencies: BatchNfoTranslatorDependencies,
): Promise<BatchTranslateApplyResultItem[]> => {
  if (items.length === 0) return [];
  if (!dependencies.localScanService) {
    throw new Error("Batch NFO translation apply requires a localScanService dependency");
  }
  if (!dependencies.llmApiClient) {
    throw new Error("Batch NFO translation apply requires an llmApiClient dependency");
  }

  assertLlmConfiguration(config);

  const logger = dependencies.logger ?? noopLogger;
  const nfoGenerator = dependencies.nfoGenerator ?? new NfoGenerator();
  const writeNfo = dependencies.writeNfo ?? defaultWriteNfo;
  const target = toTarget(config.translate.targetLanguage);
  const plans: BatchTranslationPlanItem[] = [];
  const pendingByKey = new Map<string, PendingTranslation>();

  for (const item of items) {
    const entry = await dependencies.localScanService.scanVideo(item.filePath, config.paths.sceneImagesFolder);
    if (!entry.nfoPath || !entry.crawlerData) {
      plans.push({ entry });
      continue;
    }

    const titleAction = item.pendingFields.includes("title")
      ? buildFieldAction("title", entry.crawlerData.title, entry.crawlerData.title_zh, target)
      : undefined;
    const plotAction = item.pendingFields.includes("plot")
      ? buildFieldAction("plot", entry.crawlerData.plot, entry.crawlerData.plot_zh, target)
      : undefined;

    for (const action of [titleAction, plotAction]) {
      if (action?.mode === "translate" && !pendingByKey.has(action.key)) {
        pendingByKey.set(action.key, { key: action.key, text: action.text });
      }
    }

    plans.push({ entry, titleAction, plotAction });
  }

  const translatedByKey = await translatePendingTexts(
    dependencies.llmApiClient,
    [...pendingByKey.values()],
    target,
    config,
    logger,
  );
  const results: BatchTranslateApplyResultItem[] = [];

  for (const plan of plans) {
    const entry = plan.entry;
    const baseResult = {
      filePath: entry.fileInfo.filePath,
      nfoPath: entry.nfoPath ?? "",
      directory: entry.currentDir,
      number: entry.crawlerData?.number || entry.fileInfo.number,
    };

    if (!entry.nfoPath || !entry.crawlerData) {
      results.push({
        ...baseResult,
        success: false,
        translatedFields: [],
        error: "缺少可写回的 NFO 或元数据",
      });
      continue;
    }

    const nextCrawlerData = { ...entry.crawlerData };
    const translatedFields: BatchTranslateField[] = [];
    const errors: string[] = [];

    for (const action of [plan.titleAction, plan.plotAction]) {
      if (!action) continue;

      if (action.mode === "convert") {
        if (action.field === "title") nextCrawlerData.title_zh = action.value;
        else nextCrawlerData.plot_zh = action.value;
        translatedFields.push(action.field);
        continue;
      }

      const translated = translatedByKey.get(action.key);
      if (translated) {
        if (action.field === "title") nextCrawlerData.title_zh = translated;
        else nextCrawlerData.plot_zh = translated;
        translatedFields.push(action.field);
      } else {
        errors.push(`${action.field === "title" ? "标题" : "简介"}翻译失败`);
      }
    }

    if (translatedFields.length === 0) {
      results.push({
        ...baseResult,
        success: false,
        translatedFields,
        error: errors.join("；") || "未生成任何可写回的翻译结果",
      });
      continue;
    }

    try {
      const detectedNfoNaming = await resolveExistingNfoNaming(entry.nfoPath);
      const savedNfoPath = await writeNfo({
        assets: {
          downloaded: [],
          sceneImages: [],
        },
        config: {
          download: {
            ...config.download,
            nfoNaming: detectedNfoNaming,
          },
          naming: config.naming,
        },
        crawlerData: nextCrawlerData,
        enabled: true,
        fileInfo: entry.fileInfo,
        localState: entry.nfoLocalState,
        logger,
        nfoGenerator,
        nfoPath: entry.nfoPath,
        sourceVideoPath: entry.fileInfo.filePath,
      });

      results.push({
        ...baseResult,
        success: errors.length === 0,
        translatedFields,
        savedNfoPath,
        error: errors.length > 0 ? errors.join("；") : undefined,
      });
    } catch (error) {
      results.push({
        ...baseResult,
        success: false,
        translatedFields: [],
        error: toErrorMessage(error),
      });
    }
  }

  return results;
};
