import type { Dirent, Stats } from "node:fs";
import type { MediaRoot } from "@mdcz/media-store";
import type { RootFileRef } from "@mdcz/shared/mediaRef";

export interface PublicationFileSystem {
  copyFile(source: string, target: string): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
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
