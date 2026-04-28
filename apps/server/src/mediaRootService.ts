import { stat } from "node:fs/promises";
import path from "node:path";
import {
  type MediaRootCreateInput,
  type MediaRootDto,
  type MediaRootUpdateInput,
  mediaRootCreateInputSchema,
  mediaRootUpdateInputSchema,
  type SetupStatusDto,
} from "@mdcz/shared/serverDtos";
import { createMediaRoot, type MediaRoot, normalizeHostPath } from "@mdcz/storage";
import type { ServerPersistenceService } from "./persistenceService";

const isRemoteUrl = (value: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//iu.test(value.trim());
const hasInvalidPathBytes = (value: string): boolean => value.includes("\0");

export const toMediaRootDto = (root: MediaRoot & { deleted?: boolean }): MediaRootDto => ({
  id: root.id,
  name: root.displayName,
  path: root.hostPath,
  enabled: root.enabled,
  deleted: root.deleted ?? false,
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

  async setupStatus(): Promise<SetupStatusDto> {
    const roots = (await this.list()).roots;
    return { configured: roots.some((root) => root.enabled), mediaRootCount: roots.length };
  }

  async create(input: MediaRootCreateInput): Promise<MediaRootDto> {
    const parsed = mediaRootCreateInputSchema.parse(input);
    const normalizedPath = await this.validateMountedFilesystemPath(parsed.path);
    const state = await this.persistence.getState();
    const existing = await state.repositories.mediaRoots.list();
    if (existing.some((root) => root.hostPath === normalizedPath)) {
      throw new Error(`Media root already exists: ${parsed.path}`);
    }

    const root = createMediaRoot({
      displayName: parsed.name,
      hostPath: normalizedPath,
      enabled: parsed.enabled ?? true,
    });
    return toMediaRootDto(await state.repositories.mediaRoots.upsert(root));
  }

  async update(input: MediaRootUpdateInput): Promise<MediaRootDto> {
    const parsed = mediaRootUpdateInputSchema.parse(input);
    const state = await this.persistence.getState();
    const existing = await state.repositories.mediaRoots.get(parsed.id);
    const nextHostPath = parsed.path ? await this.validateMountedFilesystemPath(parsed.path) : existing.hostPath;
    const roots = await state.repositories.mediaRoots.list();
    if (roots.some((root) => root.id !== existing.id && root.hostPath === nextHostPath)) {
      throw new Error(`Media root already exists: ${parsed.path ?? nextHostPath}`);
    }

    const updated = await state.repositories.mediaRoots.upsert({
      ...existing,
      displayName: parsed.name ?? existing.displayName,
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
      throw new Error("Media root is disabled");
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

  private async validateMountedFilesystemPath(inputPath: string): Promise<string> {
    const trimmed = inputPath.trim();
    if (!trimmed) {
      throw new Error("Media root path is required");
    }
    if (hasInvalidPathBytes(trimmed)) {
      throw new Error("Media root path contains invalid characters");
    }
    if (isRemoteUrl(trimmed)) {
      throw new Error("Remote protocol URLs are not supported in the mounted-volume alpha. Mount the share first.");
    }
    if (!path.isAbsolute(trimmed)) {
      throw new Error("Media root path must be absolute");
    }

    const normalized = normalizeHostPath(trimmed);
    const stats = await stat(normalized).catch(() => null);
    if (!stats?.isDirectory()) {
      throw new Error(`Media root directory does not exist: ${trimmed}`);
    }
    return normalized;
  }
}
