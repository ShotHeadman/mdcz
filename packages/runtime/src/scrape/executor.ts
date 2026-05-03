import PQueue from "p-queue";
import { isAbortError } from "./utils/abort";

export interface ScrapeExecutorControl {
  isStopRequested?: () => boolean;
  isPaused?: () => boolean;
  onPaused?: () => Promise<void> | void;
}

export interface ScrapeExecutorItem<TItem, TResult> {
  item: TItem;
  index: number;
  run: (signal: AbortSignal) => Promise<TResult>;
}

export interface ScrapeExecutorOptions {
  concurrency: number;
  signal?: AbortSignal;
  control?: ScrapeExecutorControl;
}

export const createStopRequestedError = (message = "Scrape stopped"): Error => new Error(message);

export const runScrapeItems = async <TItem, TResult>(
  items: readonly TItem[],
  options: ScrapeExecutorOptions,
  createItem: (item: TItem, index: number) => ScrapeExecutorItem<TItem, TResult>,
): Promise<TResult[]> => {
  const queue = new PQueue({ concurrency: Math.max(1, Math.trunc(options.concurrency)) });
  const results: TResult[] = new Array(items.length);
  const control = options.control;
  const signal = options.signal ?? new AbortController().signal;

  const tasks = items.map((item, index) =>
    queue.add(
      async () => {
        if (control?.isStopRequested?.()) {
          throw createStopRequestedError();
        }
        if (control?.isPaused?.()) {
          await control.onPaused?.();
          return;
        }

        const executorItem = createItem(item, index);
        results[index] = await executorItem.run(signal);
      },
      options.signal ? { signal } : undefined,
    ),
  );

  try {
    await Promise.all(tasks);
  } catch (error) {
    queue.clear();
    if (isAbortError(error)) {
      throw error;
    }
    throw error;
  }

  return results.filter((result): result is TResult => result !== undefined);
};
