import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { Configuration } from "@mdcz/shared/config";
import type { BatchTranslateApplyResultItem, BatchTranslateField, BatchTranslateScanItem } from "@mdcz/shared/ipcTypes";
import type { RuntimeNetworkClient } from "../network";
import { NfoGenerator, parseNfo } from "../scrape/nfo";
import { TranslateService } from "../scrape/TranslateService";
import { normalizeNewlines } from "../scrape/translate/shared";
import { toTarget } from "../scrape/translate/types";

const listNfoFiles = async (rootDirectory: string): Promise<string[]> => {
  const files: string[] = [];
  const stack = [rootDirectory];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = join(current, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === ".nfo") files.push(target);
    }
  }
  return files.sort((left, right) => left.localeCompare(right, "zh-CN"));
};

const normalizeText = (value: string | undefined): string => normalizeNewlines(value ?? "").trim();

const needsTranslation = (
  raw: string | undefined,
  translated: string | undefined,
  _target: ReturnType<typeof toTarget>,
): boolean => normalizeText(raw).length > 0 && normalizeText(translated).length === 0;

export const scanBatchNfoTranslations = async (
  directory: string,
  config: Configuration,
): Promise<BatchTranslateScanItem[]> => {
  const rootDir = resolve(directory.trim());
  if (!(await stat(rootDir)).isDirectory()) {
    throw new Error(`Directory not found: ${rootDir}`);
  }
  const target = toTarget(config.translate.targetLanguage);
  const items: BatchTranslateScanItem[] = [];
  for (const nfoPath of await listNfoFiles(rootDir)) {
    try {
      const data = parseNfo(await readFile(nfoPath, "utf8"), nfoPath);
      const pendingFields: BatchTranslateField[] = [];
      if (needsTranslation(data.title, data.title_zh, target)) pendingFields.push("title");
      if (needsTranslation(data.plot, data.plot_zh, target)) pendingFields.push("plot");
      if (pendingFields.length === 0) continue;
      items.push({
        filePath: nfoPath,
        nfoPath,
        directory: dirname(nfoPath),
        number: data.number || basename(nfoPath, extname(nfoPath)),
        title: data.title,
        pendingFields,
      });
    } catch {}
  }
  return items;
};

export const applyBatchNfoTranslations = async (
  networkClient: RuntimeNetworkClient,
  items: BatchTranslateScanItem[],
  config: Configuration,
): Promise<BatchTranslateApplyResultItem[]> => {
  const translateService = new TranslateService(networkClient);
  const generator = new NfoGenerator();
  const target = toTarget(config.translate.targetLanguage);
  const results: BatchTranslateApplyResultItem[] = [];
  for (const item of items) {
    try {
      const data = parseNfo(await readFile(item.nfoPath, "utf8"), item.nfoPath);
      const translatedFields: BatchTranslateField[] = [];
      if (item.pendingFields.includes("title") && needsTranslation(data.title, data.title_zh, target)) {
        const translated = await translateService.translateText(data.title, target, config);
        if (translated?.trim()) {
          data.title_zh = translated.trim();
          translatedFields.push("title");
        }
      }
      if (item.pendingFields.includes("plot") && needsTranslation(data.plot, data.plot_zh, target)) {
        const translated = await translateService.translateText(data.plot ?? "", target, config);
        if (translated?.trim()) {
          data.plot_zh = translated.trim();
          translatedFields.push("plot");
        }
      }
      const savedNfoPath =
        translatedFields.length > 0
          ? await generator.writeNfo(item.nfoPath, data, {
              nfoNaming: config.download.nfoNaming,
              nfoTitleTemplate: config.naming.nfoTitleTemplate,
            })
          : undefined;
      results.push({
        filePath: item.filePath,
        nfoPath: item.nfoPath,
        directory: item.directory,
        number: item.number,
        success: true,
        translatedFields,
        savedNfoPath,
      });
    } catch (error) {
      results.push({
        filePath: item.filePath,
        nfoPath: item.nfoPath,
        directory: item.directory,
        number: item.number,
        success: false,
        translatedFields: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
};
