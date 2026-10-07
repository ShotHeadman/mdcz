import { copyFile, link, lstat, mkdir, open, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import type { PublicationFileSystem } from "./types";

export const outputFileSystem: PublicationFileSystem = {
  copyFile,
  link,
  symlink: async (target, path) => await symlink(target, path, "file"),
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  lstat,
  writeFile,
  flush: async (filePath) => {
    const handle = await open(filePath, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
};
