import { stat } from "node:fs/promises";
import path from "node:path";
import { createMediaRoot, type MediaRoot, normalizeHostPath } from "@mdcz/media-store";
import {
  type MediaRootAvailabilityDto,
  type MediaRootCreateInput,
  type MediaRootDto,
  mediaRootCreateInputSchema,
} from "@mdcz/shared/serverDtos";
import type { ServerPersistenceService } from "./persistenceService";

const isRemoteUrl = (value: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//iu.test(value.trim());
const hasInvalidPathBytes = (value: string): boolean => value.includes("\0");

export const METADATA_OUTPUT_ROOT_ID = "mdcz-metadata-output";
const METADATA_OUTPUT_ROOT_DISPLAY_NAME = "本地元数据目录";

export const toMediaRootDto = (root: MediaRoot & { availability?: MediaRootAvailabilityDto }): MediaRootDto => ({
  id: root.id,
  displayName: root.displayName,
  hostPath: root.hostPath,
  availability: root.availability,
  createdAt: root.createdAt.toISOString(),
  updatedAt: root.updatedAt.toISOString(),
});

export class MediaRootService {
  constructor(private readonly persistence: ServerPersistenceService) {}

  async list(): Promise<{ roots: MediaRootDto[] }> {
    const state = await this.persistence.getState();
    const roots = (await state.repositories.mediaRoots.list()).filter((root) => root.id !== METADATA_OUTPUT_ROOT_ID);
    return { roots: roots.map(toMediaRootDto) };
  }

  async ensurePath(input: MediaRootCreateInput): Promise<MediaRootDto>;
  async ensurePath(hostPath: string): Promise<MediaRoot>;
  async ensurePath(input: MediaRootCreateInput | string): Promise<MediaRootDto | MediaRoot> {
    if (typeof input === "string") {
      const normalizedPath = await this.validateMountedFilesystemPath(input);
      const state = await this.persistence.getState();
      return await state.repositories.mediaRoots.ensurePath(normalizedPath);
    }
    const parsed = mediaRootCreateInputSchema.parse(input);
    const normalizedPath = await this.validateMountedFilesystemPath(parsed.hostPath);
    const state = await this.persistence.getState();
    return toMediaRootDto(await state.repositories.mediaRoots.ensurePath(normalizedPath, parsed.displayName));
  }

  async ensureMetadataRoot(hostPath: string): Promise<MediaRoot> {
    const normalizedPath = await this.validateMountedFilesystemPath(hostPath);
    const state = await this.persistence.getState();
    const existing = await state.repositories.mediaRoots.get(METADATA_OUTPUT_ROOT_ID).catch(() => null);
    const now = new Date();

    return await state.repositories.mediaRoots.upsert({
      ...(existing ??
        createMediaRoot({
          id: METADATA_OUTPUT_ROOT_ID,
          displayName: METADATA_OUTPUT_ROOT_DISPLAY_NAME,
          hostPath: normalizedPath,
          now,
        })),
      displayName: METADATA_OUTPUT_ROOT_DISPLAY_NAME,
      hostPath: normalizedPath,
      updatedAt: now,
    });
  }

  async setupStatus(): Promise<{ configured: boolean; mediaRootCount: number }> {
    const roots = (await this.list()).roots;
    return { configured: roots.length > 0, mediaRootCount: roots.length };
  }

  async get(id: string): Promise<MediaRoot> {
    const state = await this.persistence.getState();
    const root = await state.repositories.mediaRoots.get(id);
    await this.validateMountedFilesystemPath(root.hostPath);
    return root;
  }

  private async checkAvailability(hostPath: string): Promise<MediaRootAvailabilityDto> {
    const checkedAt = new Date().toISOString();
    try {
      const stats = await stat(hostPath);
      if (!stats.isDirectory()) {
        return { available: false, checkedAt, error: "媒体目录路径不是目录" };
      }
      return { available: true, checkedAt, error: null };
    } catch (error) {
      return { available: false, checkedAt, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async validateMountedFilesystemPath(inputPath: string): Promise<string> {
    const trimmed = inputPath.trim();
    if (!trimmed) {
      throw new Error("媒体目录路径不能为空");
    }
    if (hasInvalidPathBytes(trimmed)) {
      throw new Error("媒体目录路径包含非法字符");
    }
    if (isRemoteUrl(trimmed)) {
      throw new Error("暂不支持原生远程协议 URL，请先在系统中挂载共享目录。");
    }
    if (!path.isAbsolute(trimmed)) {
      throw new Error("媒体目录路径必须是绝对路径");
    }

    const normalized = normalizeHostPath(trimmed);
    const availability = await this.checkAvailability(normalized);
    if (!availability.available) {
      throw new Error(availability.error ?? `媒体目录不存在：${trimmed}`);
    }
    return normalized;
  }
}
