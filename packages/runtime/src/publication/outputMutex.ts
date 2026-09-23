import { realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { filesystemPathKey } from "@mdcz/media-store";

type Waiter = { promise: Promise<void>; release: () => void };
const tails = new Map<string, Waiter>();
let registration = Promise.resolve();

const resolveCanonicalOutputDirectory = async (directory: string): Promise<string> => {
  try {
    return await realpath(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (dirname(directory) === directory) return filesystemPathKey(directory);
    return join(await resolveCanonicalOutputDirectory(dirname(directory)), basename(directory));
  }
};

export const acquireOutputDirectories = async (
  targetPaths: readonly string[],
  canonicalDirectory: (directory: string) => Promise<string> = resolveCanonicalOutputDirectory,
): Promise<() => void> => {
  let waiters: Array<{ key: string; previous: Promise<void>; waiter: Waiter }> = [];
  let releaseRegistration!: () => void;
  const previousRegistration = registration;
  registration = new Promise<void>((resolve) => {
    releaseRegistration = resolve;
  });
  try {
    await previousRegistration;
    const keys = [
      ...new Set(
        await Promise.all(
          targetPaths.map(async (targetPath) => filesystemPathKey(await canonicalDirectory(dirname(targetPath)))),
        ),
      ),
    ].sort();
    waiters = keys.map((key) => {
      const previous = (tails.get(key)?.promise ?? Promise.resolve()).catch(() => {});
      let release!: () => void;
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      const waiter = { promise, release };
      tails.set(key, waiter);
      return { key, previous, waiter };
    });
  } finally {
    releaseRegistration();
  }
  await Promise.all(waiters.map(({ previous }) => previous));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const { key, waiter } of waiters) {
      waiter.release();
      if (tails.get(key) === waiter) tails.delete(key);
    }
  };
};
