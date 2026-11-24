import type { Dirent, Stats } from "node:fs";
import type { MediaRoot } from "@mdcz/media-store";
import type { RootFileRef } from "@mdcz/shared/mediaRef";

export interface PublicationFileSystem {
  copyFile(source: string, target: string): Promise<void>;
  /** A plain write(2) stream, for cloud mounts that refuse the kernel's accelerated copy on a file just created. */
  copyFileBytes(source: string, target: string): Promise<void>;
  link(existingPath: string, newPath: string): Promise<void>;
  symlink(target: string, path: string): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<string | undefined>;
  rmdir(path: string): Promise<void>;
  readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  rename(source: string, target: string): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
  stat(path: string): Promise<Stats>;
  lstat(path: string): Promise<Stats>;
  writeFile(path: string, data: Buffer | string, options?: { flush?: boolean }): Promise<void>;
  flush?(path: string): Promise<void>;
}

export interface PublicationOutputPort {
  publicationRoots(): Array<Pick<MediaRoot, "id" | "hostPath">>;
  publicationSnapshot(query: { paths?: readonly string[]; kind?: string; includeOwners?: boolean }): {
    files: Array<RootFileRef & { itemId: string; fileId?: string; mediaIdentity?: string | null; size?: number }>;
    assets: Array<RootFileRef & { itemId: string; fileId: string | null; kind: string; published: boolean }>;
  };
}
