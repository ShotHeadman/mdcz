const toNonNegativeInteger = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;

export interface RecoverableSessionSummary {
  recoverable: boolean;
  pendingCount: number;
  failedCount: number;
}

export const summarizeRecoverableSession = (input: {
  pendingCount?: number;
  failedCount?: number;
}): RecoverableSessionSummary => {
  const pendingCount = toNonNegativeInteger(input.pendingCount);
  const failedCount = toNonNegativeInteger(input.failedCount);
  return {
    recoverable: pendingCount > 0 || failedCount > 0,
    pendingCount,
    failedCount,
  };
};

export type RecoverableSessionAction = "recover" | "discard";

export interface RecoverableSessionResolveResult<TTask> {
  success: true;
  message: string;
  task: TTask | null;
}

export interface RecoverableSessionPort<TSummary extends RecoverableSessionSummary, TTask> {
  summarize(): Promise<TSummary>;
  recover(): Promise<TTask>;
  discard(): Promise<void>;
}

export const resolveRecoverableSession = async <TSummary extends RecoverableSessionSummary, TTask>(
  port: RecoverableSessionPort<TSummary, TTask>,
  input: {
    action?: RecoverableSessionAction;
    recoverMessage?: string;
    discardMessage?: string;
  } = {},
): Promise<RecoverableSessionResolveResult<TTask>> => {
  const action = input.action ?? "recover";
  if (action === "discard") {
    await port.discard();
    return {
      success: true,
      message: input.discardMessage ?? "Recoverable session discarded",
      task: null,
    };
  }

  return {
    success: true,
    message: input.recoverMessage ?? "Recoverable session recovered",
    task: await port.recover(),
  };
};
