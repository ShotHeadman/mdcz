import { lstat } from "node:fs/promises";
import type { RootBrowserEntryDto, RootBrowserInput, RootBrowserResponse } from "@mdcz/shared/serverDtos";
import { classifyFileName, isVideoFileName } from "@mdcz/shared/videoClassification";
import { listRootDirectory, resolveRootRelativePath } from "@mdcz/storage";
import { type MediaRootService, toMediaRootDto } from "./mediaRootService";

export class BrowserService {
  constructor(private readonly mediaRoots: MediaRootService) {}

  async list(input: RootBrowserInput): Promise<RootBrowserResponse> {
    const root = await this.mediaRoots.getActiveRoot(input.rootId);
    const entries = await listRootDirectory(root, input.relativePath ?? "");
    const browserEntries: RootBrowserEntryDto[] = [];

    for (const entry of entries) {
      if (entry.kind !== "directory" && entry.kind !== "file") {
        continue;
      }
      if (entry.kind === "file" && !isVideoFileName(entry.name)) {
        continue;
      }
      const stats = await lstat(resolveRootRelativePath(root, entry.path)).catch(() => null);
      if (stats?.isSymbolicLink()) {
        continue;
      }
      browserEntries.push({
        type: entry.kind,
        name: entry.name,
        relativePath: entry.path,
        size: entry.kind === "file" ? entry.size : undefined,
        lastModified: entry.modifiedAt.toISOString(),
        classification: entry.kind === "file" ? classifyFileName(entry.name) : undefined,
      });
    }

    browserEntries.sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "directory" ? -1 : 1;
      }
      return left.name.localeCompare(right.name, "zh-CN");
    });

    return {
      root: toMediaRootDto(root),
      relativePath: input.relativePath ?? "",
      entries: browserEntries,
    };
  }
}
