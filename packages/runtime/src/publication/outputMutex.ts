import { dirname } from "node:path";
import { filesystemPathKey } from "@mdcz/media-store";

type Waiter = { promise: Promise<void>; release: () => void };
const tails = new Map<string, Waiter>();

export const acquireOutputDirectories = async (targetPaths: readonly string[]): Promise<() => void> => {
  const keys = [...new Set(targetPaths.map((targetPath) => filesystemPathKey(dirname(targetPath))))].sort();
  const waiters = keys.map((key) => {
    const previous = tails.get(key)?.promise ?? Promise.resolve();
    let resolve!: () => void;
    const promise = previous.then(() => new Promise<void>((done) => (resolve = done)));
    const waiter = { promise, release: () => resolve() };
    tails.set(key, waiter);
    return { key, previous, waiter };
  });
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
