import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  type MediaRoot,
  normalizeHostPath,
  resolveRootFile,
  resolveRootRelativePath,
  toRootRelativePath,
} from "@mdcz/media-store";
import type { Configuration } from "@mdcz/shared/config";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import {
  type MediaRootAvailabilityDto,
  type MediaRootDto,
  type MediaRootEnsurePathInput,
  type MediaRootEnsurePathResponse,
  mediaRootEnsurePathInputSchema,
} from "@mdcz/shared/serverDtos";

export interface MediaRootRegistryPort {
  ensurePath(hostPath: string, displayName?: string): Promise<MediaRoot>;
  list(): Promise<readonly MediaRoot[]>;
  get(id: string): Promise<MediaRoot>;
}

export interface ConfiguredRootSyncOptions {
  strict?: boolean;
  onUnavailable?: (hostPath: string, error: unknown) => void;
}

const isRemoteUrl = (value: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//iu.test(value.trim());
const hasInvalidPathBytes = (value: string): boolean => value.includes("\0");

export const toMediaRootDto = (root: MediaRoot & { availability?: MediaRootAvailabilityDto }): MediaRootDto => ({
  id: root.id,
  displayName: root.displayName,
  hostPath: root.hostPath,
  availability: root.availability,
  createdAt: root.createdAt.toISOString(),
  updatedAt: root.updatedAt.toISOString(),
});

const uniquePaths = (paths: string[]): string[] => {
  const seen = new Set<string>();
  return paths.filter((value) => {
    const normalized = normalizeHostPath(value);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
};

const configuredRootPaths = (configuration: Configuration): string[] => {
  const paths = configuration.paths;
  const configured = [paths.mediaPath, paths.metadataPath];
  configured.push(
    ...[
      paths.actorPhotoFolder,
      paths.outputSummaryPath,
      paths.successOutputFolder,
      paths.failedOutputFolder,
      paths.softlinkPath,
    ].filter((value) => path.isAbsolute(value.trim())),
  );
  return uniquePaths(configured.map((value) => value.trim()).filter(Boolean));
};

export class ConfiguredMediaRootService {
  constructor(private readonly registry: MediaRootRegistryPort) {}

  async list(): Promise<{ roots: MediaRootDto[] }> {
    return { roots: (await this.listRoots()).map(toMediaRootDto) };
  }

  async listRoots(): Promise<MediaRoot[]> {
    return [...(await this.registry.list())];
  }

  async ensurePath(input: MediaRootEnsurePathInput): Promise<MediaRootEnsurePathResponse> {
    const parsed = mediaRootEnsurePathInputSchema.parse(input);
    const root = await this.ensurePathRecord(parsed);
    return {
      ...toMediaRootDto(root),
      relativeDirectory: toRootRelativePath(root, normalizeHostPath(parsed.hostPath)),
    };
  }

  async ensurePathRecord(input: MediaRootEnsurePathInput): Promise<MediaRoot> {
    const parsed = mediaRootEnsurePathInputSchema.parse(input);
    const normalizedPath = await this.validateMountedFilesystemPath(parsed.hostPath);
    return await this.registry.ensurePath(normalizedPath, parsed.displayName);
  }

  async prepareOutputDirectory(input: MediaRootEnsurePathInput): Promise<MediaRootEnsurePathResponse> {
    const parsed = mediaRootEnsurePathInputSchema.parse(input);
    const targetPath = parsed.hostPath.trim();
    this.validatePathSyntax(targetPath);
    await mkdir(targetPath, { recursive: true });
    return await this.ensurePath(parsed);
  }

  async setupStatus(): Promise<{ configured: boolean; mediaRootCount: number }> {
    const roots = await this.listRoots();
    return { configured: roots.length > 0, mediaRootCount: roots.length };
  }

  async get(id: string): Promise<MediaRoot> {
    return await this.registry.get(id);
  }

  async canonicalizeFileRefs(refs: readonly RootFileRef[]): Promise<RootFileRef[]> {
    const roots = await this.listRoots();
    const rootsById = new Map(roots.map((root) => [root.id, root]));
    return refs.map((ref) => {
      const referencedRoot = rootsById.get(ref.rootId);
      if (!referencedRoot) throw new Error(`Media root not found: ${ref.rootId}`);
      const resolved = resolveRootFile(roots, resolveRootRelativePath(referencedRoot, ref.relativePath));
      return { rootId: resolved.root.id, relativePath: resolved.relativePath };
    });
  }

  async synchronizeConfiguredRoots(
    configuration: Configuration,
    options: ConfiguredRootSyncOptions = {},
  ): Promise<void> {
    for (const hostPath of configuredRootPaths(configuration)) {
      try {
        await this.ensurePathRecord({ hostPath });
      } catch (error) {
        if (options.strict) throw error;
        options.onUnavailable?.(hostPath, error);
      }
    }
  }

  private async validateMountedFilesystemPath(inputPath: string): Promise<string> {
    const trimmed = inputPath.trim();
    this.validatePathSyntax(trimmed);
    const normalized = normalizeHostPath(trimmed);
    const availability = await this.checkAvailability(normalized);
    if (!availability.available) {
      throw new Error(availability.error ?? `媒体目录不存在：${trimmed}`);
    }
    return normalized;
  }

  private async checkAvailability(hostPath: string): Promise<MediaRootAvailabilityDto> {
    const checkedAt = new Date().toISOString();
    try {
      const stats = await stat(hostPath);
      if (!stats.isDirectory()) return { available: false, checkedAt, error: "媒体目录路径不是目录" };
      return { available: true, checkedAt, error: null };
    } catch (error) {
      return { available: false, checkedAt, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private validatePathSyntax(trimmed: string): void {
    if (!trimmed) throw new Error("媒体目录路径不能为空");
    if (hasInvalidPathBytes(trimmed)) throw new Error("媒体目录路径包含非法字符");
    if (isRemoteUrl(trimmed)) throw new Error("暂不支持原生远程协议 URL，请先在系统中挂载共享目录。");
    if (!path.isAbsolute(trimmed)) throw new Error("媒体目录路径必须是绝对路径");
  }
}
