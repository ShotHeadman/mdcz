import { stat } from "node:fs/promises";
import path from "node:path";
import {
  type MediaRootAvailabilityDto,
  type MediaRootAvailabilityResponse,
  type MediaRootCreateInput,
  type MediaRootDto,
  type MediaRootUpdateInput,
  mediaRootCreateInputSchema,
  mediaRootUpdateInputSchema,
} from "@mdcz/shared/serverDtos";
import { createMediaRoot, type MediaRoot, normalizeHostPath } from "@mdcz/storage";
import type { ServerPersistenceService } from "./persistenceService";

const isRemoteUrl = (value: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//iu.test(value.trim());
const hasInvalidPathBytes = (value: string): boolean => value.includes("\0");

export const toMediaRootDto = (
  root: MediaRoot & { deleted?: boolean; availability?: MediaRootAvailabilityDto },
): MediaRootDto => ({
  id: root.id,
  displayName: root.displayName,
  hostPath: root.hostPath,
  rootType: root.rootType,
  enabled: root.enabled,
  deleted: root.deleted ?? false,
  availability: root.availability,
  createdAt: root.createdAt.toISOString(),
  updatedAt: root.updatedAt.toISOString(),
});

export class MediaRootService {
  constructor(private readonly persistence: ServerPersistenceService) {}

  async list(): Promise<{ roots: MediaRootDto[] }> {
    const state = await this.persistence.getState();
    const roots = await state.repositories.mediaRoots.list();
    return { roots: roots.map(toMediaRootDto) };
  }

  async setupStatus(): Promise<{ configured: boolean; mediaRootCount: number }> {
    const roots = (await this.list()).roots;
    return { configured: roots.some((root) => root.enabled), mediaRootCount: roots.length };
  }

  async availability(id: string): Promise<MediaRootAvailabilityResponse> {
    const state = await this.persistence.getState();
    const root = await state.repositories.mediaRoots.get(id);
    const availability = await this.checkAvailability(root.hostPath);
    return { root: toMediaRootDto({ ...root, availability }), availability };
  }

  async create(input: MediaRootCreateInput): Promise<MediaRootDto> {
    const parsed = mediaRootCreateInputSchema.parse(input);
    const normalizedPath = await this.validateMountedFilesystemPath(parsed.hostPath);
    const state = await this.persistence.getState();
    const existing = await state.repositories.mediaRoots.list();
    if (existing.some((root) => root.hostPath === normalizedPath)) {
      throw new Error(`媒体目录已存在：${parsed.hostPath}`);
    }

    const root = createMediaRoot({
      displayName: parsed.displayName,
      hostPath: normalizedPath,
      enabled: parsed.enabled ?? true,
    });
    return toMediaRootDto(await state.repositories.mediaRoots.upsert(root));
  }

  async update(input: MediaRootUpdateInput): Promise<MediaRootDto> {
    const parsed = mediaRootUpdateInputSchema.parse(input);
    const state = await this.persistence.getState();
    const existing = await state.repositories.mediaRoots.get(parsed.id);
    const nextHostPath = parsed.hostPath
      ? await this.validateMountedFilesystemPath(parsed.hostPath)
      : existing.hostPath;
    const roots = await state.repositories.mediaRoots.list();
    if (roots.some((root) => root.id !== existing.id && root.hostPath === nextHostPath)) {
      throw new Error(`媒体目录已存在：${parsed.hostPath ?? nextHostPath}`);
    }

    const updated = await state.repositories.mediaRoots.upsert({
      ...existing,
      displayName: parsed.displayName ?? existing.displayName,
      hostPath: nextHostPath,
      enabled: parsed.enabled ?? existing.enabled,
      updatedAt: new Date(),
    });
    return toMediaRootDto(updated);
  }

  async enable(id: string): Promise<MediaRootDto> {
    return await this.setEnabled(id, true);
  }

  async disable(id: string): Promise<MediaRootDto> {
    return await this.setEnabled(id, false);
  }

  async softDelete(id: string): Promise<MediaRootDto> {
    const state = await this.persistence.getState();
    const root = await state.repositories.mediaRoots.get(id);
    return toMediaRootDto(
      await state.repositories.mediaRoots.upsert({
        ...root,
        enabled: false,
        deleted: true,
        updatedAt: new Date(),
      }),
    );
  }

  async getActiveRoot(id: string): Promise<MediaRoot> {
    const state = await this.persistence.getState();
    const root = await state.repositories.mediaRoots.get(id);
    if (!root.enabled) {
      throw new Error("媒体目录已停用");
    }
    await this.validateMountedFilesystemPath(root.hostPath);
    return root;
  }

  private async setEnabled(id: string, enabled: boolean): Promise<MediaRootDto> {
    const state = await this.persistence.getState();
    const root = await state.repositories.mediaRoots.get(id);
    if (enabled) {
      await this.validateMountedFilesystemPath(root.hostPath);
    }
    return toMediaRootDto(
      await state.repositories.mediaRoots.upsert({
        ...root,
        enabled,
        updatedAt: new Date(),
      }),
    );
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
