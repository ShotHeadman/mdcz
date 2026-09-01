export interface RefreshCoordinator {
  dispose(): void;
  request(): Promise<void>;
}

export const createRefreshCoordinator = <T>(input: {
  apply(response: T): void;
  onError?(error: unknown): void;
  onSuccess?(): void;
  read(): Promise<T>;
}): RefreshCoordinator => {
  let disposed = false;
  let dirty = false;
  let inFlight = false;
  let activeRequest: Promise<void> | null = null;
  let requestedVersion = 0;

  const drain = async (): Promise<void> => {
    try {
      while (dirty && !disposed) {
        dirty = false;
        const version = requestedVersion;
        try {
          const response = await input.read();
          if (disposed) return;
          if (version !== requestedVersion) continue;
          input.apply(response);
          input.onSuccess?.();
        } catch (error) {
          input.onError?.(error);
          dirty = true;
          return;
        }
      }
    } finally {
      inFlight = false;
      activeRequest = null;
    }
  };

  return {
    request: async () => {
      dirty = true;
      requestedVersion += 1;
      if (!inFlight) {
        inFlight = true;
        activeRequest = drain();
      }
      await activeRequest;
    },
    dispose: () => {
      disposed = true;
    },
  };
};
