import { createRefreshCoordinator } from "@mdcz/views/state/refreshCoordinator";
import { describe, expect, it, vi } from "vitest";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

describe("createRefreshCoordinator", () => {
  it("serializes refreshes and discards a response superseded while in flight", async () => {
    const first = deferred<number>();
    const second = deferred<number>();
    const apply = vi.fn();
    const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const coordinator = createRefreshCoordinator({ apply, read });

    const initialRequest = coordinator.request();
    const newerRequest = coordinator.request();
    first.resolve(1);
    await Promise.resolve();
    expect(apply).not.toHaveBeenCalled();
    second.resolve(2);
    await Promise.all([initialRequest, newerRequest]);

    expect(read).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith(2);
  });

  it("reports refresh errors and clears them after a later success", async () => {
    const failure = new Error("offline");
    const apply = vi.fn();
    const onError = vi.fn();
    const onSuccess = vi.fn();
    const read = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(2);
    const coordinator = createRefreshCoordinator({ apply, onError, onSuccess, read });

    await coordinator.request();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(apply).not.toHaveBeenCalled();

    await coordinator.request();
    expect(apply).toHaveBeenCalledWith(2);
    expect(onSuccess).toHaveBeenCalledOnce();
  });
});
