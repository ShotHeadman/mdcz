import { stat } from "node:fs/promises";
import { resolveRootRelativePath } from "@mdcz/media-store";
import { libraryAvailability } from "@mdcz/shared/libraryAvailability";
import type { LibraryAvailabilityResponse } from "@mdcz/shared/serverDtos";

type Root = { hostPath: string };
type AvailabilityEntry = { id: string; files: Array<{ id: string; rootId: string; rootRelativePath: string }> };

const keyFor = (root: Root, relativePath: string): string => `${root.hostPath}\0${relativePath}`;

export class LibraryAvailabilityChecker {
  private readonly cache = new Map<string, { available: boolean; error: string | null; expiresAt: number }>();

  async check(root: Root, relativePath: string): Promise<boolean> {
    const key = keyFor(root, relativePath);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.available;
    let available = false;
    let error: string | null = null;
    try {
      const stats = await stat(resolveRootRelativePath(root, relativePath));
      available = stats.isFile();
      if (!available) error = "路径不是文件";
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      try {
        await stat(root.hostPath);
        error =
          (cause as NodeJS.ErrnoException).code === "ENOENT"
            ? `文件缺失，仅保留媒体库记录：${resolveRootRelativePath(root, relativePath)}`
            : `无法检查文件：${message}`;
      } catch (rootError) {
        error = `媒体根目录不可访问：${root.hostPath}（${rootError instanceof Error ? rootError.message : String(rootError)}）`;
      }
    }
    this.cache.set(key, { available, error, expiresAt: Date.now() + 30_000 });
    return available;
  }

  error(root: Root, relativePath: string): string | null {
    return this.cache.get(keyFor(root, relativePath))?.error ?? null;
  }

  async entries(
    records: readonly AvailabilityEntry[],
    roots: ReadonlyMap<string, Root>,
  ): Promise<LibraryAvailabilityResponse> {
    const paths = new Map<string, { root: Root; relativePath: string }>();
    for (const entry of records) {
      for (const file of entry.files) {
        const root = roots.get(file.rootId);
        if (root) paths.set(keyFor(root, file.rootRelativePath), { root, relativePath: file.rootRelativePath });
      }
    }
    const pending = [...paths];
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(8, pending.length) }, async () => {
        while (next < pending.length) {
          const path = pending[next++];
          if (path) await this.check(path[1].root, path[1].relativePath);
        }
      }),
    );
    return {
      entries: records.map((entry) => {
        const fileRefs = entry.files.map((file) => {
          const root = roots.get(file.rootId);
          return {
            id: file.id,
            available: root ? (this.cache.get(keyFor(root, file.rootRelativePath))?.available ?? false) : null,
            availabilityError: root ? this.error(root, file.rootRelativePath) : "媒体根目录未登记",
          };
        });
        return { id: entry.id, available: libraryAvailability(fileRefs), fileRefs };
      }),
    };
  }
}
