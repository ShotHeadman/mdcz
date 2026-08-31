import { ipc } from "./ipc";
import type { ConfigOutput, CreateSoftlinksBody, ScrapeFileBody, UpdateConfigData } from "./types";

type ThrowOption = {
  throwOnError?: boolean;
};

export const getCurrentConfig = async (_options?: ThrowOption) => {
  const data = (await ipc.config.get()) as ConfigOutput;
  return { data };
};

export const updateConfig = async (options: UpdateConfigData & ThrowOption) => {
  const payload = (options.body ?? {}) as Record<string, unknown>;
  const data = await ipc.config.save(payload);
  return { data };
};

export const scrapeSingleFile = async (options: { body: ScrapeFileBody } & ThrowOption) => {
  const path = options.body.path?.trim();
  if (!path) {
    throw new Error("Path is required");
  }
  const data = await ipc.scraper.startSinglePath(path);
  return { data };
};

export const createSymlink = async (options: { body: CreateSoftlinksBody } & ThrowOption) => {
  const sourceDir = options.body.source_dir?.trim();
  const destDir = options.body.dest_dir?.trim();
  if (!sourceDir || !destDir) {
    throw new Error("Source and destination directories are required");
  }

  const data = await ipc.tool.createSymlink({
    sourceDir,
    destDir,
    copyFiles: Boolean(options.body.copy_files),
  });

  return { data };
};
