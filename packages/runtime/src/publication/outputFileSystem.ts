import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { PublicationFileSystem } from "./types";

const WINDOWS_LOCK_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);
const WINDOWS_LOCK_RETRY_MS = 10_000;

// Antivirus, the search indexer and SMB servers briefly hold files open on Windows, failing renames and deletes
// with EPERM/EBUSY/EACCES. Retrying with VS Code's backoff rides those out; a lasting lock still fails within the budget.
const retryWhileLocked = async (operation: () => Promise<void>, canRetry: () => Promise<boolean>): Promise<void> => {
  const startedAt = Date.now();
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (
        process.platform !== "win32" ||
        !WINDOWS_LOCK_CODES.has((error as NodeJS.ErrnoException).code ?? "") ||
        Date.now() - startedAt >= WINDOWS_LOCK_RETRY_MS ||
        !(await canRetry())
      )
        throw error;
      await delay(Math.min(100, attempt * 10));
    }
  }
};

// Cloud mounts register a new file's metadata for 10-30 seconds and refuse kernel copy acceleration until then:
// libuv's copyfile stamps times and modes on the file it creates and copies with sendfile(2), so fs.copyFile fails
// with EIO. A plain write(2) stream never asks for either and works throughout; ENOSPC and ENOENT stay fatal.
const KERNEL_REFUSALS = new Set(["EIO", "EINVAL", "EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV"]);
const isKernelRefusal = (error: unknown) =>
  KERNEL_REFUSALS.has((error as NodeJS.ErrnoException | undefined)?.code ?? "");

/** Copies byte by byte with write(2), the one file operation cloud mounts perform on a file they have just created. */
const copyFileBytes = async (source: string, target: string): Promise<void> => {
  await pipeline(createReadStream(source), createWriteStream(target));
};

const copyFileReliably = async (source: string, target: string): Promise<void> => {
  try {
    await copyFile(source, target);
  } catch (error) {
    if (!isKernelRefusal(error)) throw error;
    await copyFileBytes(source, target);
  }
};

export const outputFileSystem: PublicationFileSystem = {
  copyFile: copyFileReliably,
  copyFileBytes,
  link,
  symlink: async (target, path) => await symlink(target, path, "file"),
  mkdir,
  rmdir,
  readdir,
  // A rename is retried only while its target stays absent, so a retry never replaces a file that appeared meanwhile.
  rename: async (source, target) =>
    await retryWhileLocked(
      async () => await rename(source, target),
      async () =>
        await lstat(target).then(
          () => false,
          (error: NodeJS.ErrnoException) => error.code === "ENOENT",
        ),
    ),
  rm: async (filePath, options) =>
    await retryWhileLocked(
      async () => await rm(filePath, options),
      async () => true,
    ),
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

/**
 * Writes a file to `destination`, flushed to disk, and checks it came out at `size`. A direct write copies byte by
 * byte, since the kernel's accelerated copy stamps times and modes on the file it creates, which a cloud mount refuses
 * for as long as the upload registers.
 */
export const writeVerifiedFile = async (
  fileSystem: PublicationFileSystem,
  destination: string,
  content: { data: Buffer | string } | { sourcePath: string },
  size: number,
  direct: boolean,
): Promise<void> => {
  if ("data" in content) {
    await fileSystem.writeFile(destination, content.data, { flush: true });
  } else {
    if (direct) await fileSystem.copyFileBytes(content.sourcePath, destination);
    else await fileSystem.copyFile(content.sourcePath, destination);
    await fileSystem.flush?.(destination);
  }
  if ((await fileSystem.stat(destination)).size !== size) throw new Error(`Written file size mismatch: ${destination}`);
};

/** Removes `directory` if it is empty; false when it holds anything, is already gone, or cannot be removed. */
export const removeEmptyDirectory = async (
  fileSystem: PublicationFileSystem,
  directory: string,
  warn: (message: string) => void,
): Promise<boolean> => {
  try {
    await fileSystem.rmdir(directory);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOTEMPTY" && code !== "EEXIST" && code !== "ENOENT")
      warn(`Failed to remove empty directory ${directory}: ${error instanceof Error ? error.message : error}`);
    return false;
  }
};

/** Directories one publication created, so a failed one can take back the empty folders it left behind. */
export class CreatedDirectories {
  readonly #created: Array<{ leaf: string; top: string }> = [];

  constructor(private readonly fileSystem: PublicationFileSystem) {}

  async make(directory: string): Promise<void> {
    const top = await this.fileSystem.mkdir(directory, { recursive: true });
    if (top) this.#created.push({ leaf: path.resolve(directory), top: path.resolve(top) });
  }

  async removeEmpty(warn: (message: string) => void): Promise<void> {
    for (const { leaf, top } of this.#created.toReversed()) {
      for (let current = leaf; ; current = path.dirname(current)) {
        if (!(await removeEmptyDirectory(this.fileSystem, current, warn)) || current === top) break;
      }
    }
  }
}

/** Probed once per library save and scrape run, so a refused symlink fails up front instead of on every movie. */
export const assertSymlinkSupport = async (directory: string): Promise<void> => {
  const probePath = path.join(directory, `.mdcz-symlink-probe-${randomUUID()}`);
  try {
    await symlink("missing-target", probePath, "file");
  } catch (error) {
    // Unelevated Windows processes lack SeCreateSymbolicLinkPrivilege unless Developer Mode is on.
    if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM")
      throw new Error(
        "The current user's permissions are insufficient to create symlinks. Please right-click the application and select 'Run as administrator'.",
        { cause: error },
      );
    throw error;
  }
  await rm(probePath, { force: true });
};
