import { copyFile, lstat, mkdir, open, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import type { PublicationFileSystem } from "./types";

export const outputFileSystem: PublicationFileSystem = {
  copyFile,
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
