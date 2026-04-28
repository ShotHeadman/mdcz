export const didPromiseTimeout = async (promise: Promise<unknown>, timeoutMs: number): Promise<boolean> => {
  if (timeoutMs <= 0) {
    return false;
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const result = await Promise.race([
      promise.then(() => "settled" as const),
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
      }),
    ]);

    return result === "timeout";
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

export const mapWithConcurrency = async <TItem, TResult>(
  items: readonly TItem[],
  concurrency: number,
  mapper: (item: TItem, index: number) => Promise<TResult>,
): Promise<TResult[]> => {
  if (items.length === 0) {
    return [];
  }

  const maxWorkers = Math.min(items.length, Math.max(1, Math.trunc(concurrency)));
  const outputs = new Array<TResult>(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      outputs[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  };

  await Promise.all(Array.from({ length: maxWorkers }, () => worker()));
  return outputs;
};
