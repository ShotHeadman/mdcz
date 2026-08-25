import { type MediaRoot, toRootRelativePath } from "@mdcz/media-store";
import type { MaintenanceTaskRef } from "@mdcz/shared/maintenanceTasks";
import type { LocalScanEntry } from "@mdcz/shared/types";
import type { MaintenanceLibraryPort, MaintenanceRootPort } from "./coordinatorContracts";
import type { MaintenanceEventProjector } from "./MaintenanceEventProjector";
import type { MaintenanceRuntime } from "./MaintenanceRuntime";
import { assertUniqueMaintenanceRefs, type MaintenanceSessionStore } from "./MaintenanceSessionState";

export type MaintenanceExecutorControl = {
  pause(): void;
  stop(): void;
};

export type ActiveMaintenanceExecution = {
  sessionId: string;
  generation: number;
  phase: "preview" | "apply";
  executor: MaintenanceExecutorControl;
};

export interface MaintenanceRunnerDependencies {
  roots: MaintenanceRootPort;
  runtime: MaintenanceRuntime;
  library: MaintenanceLibraryPort;
  sessions: MaintenanceSessionStore;
  projector: MaintenanceEventProjector;
  activate(execution: ActiveMaintenanceExecution): void;
  deactivate(sessionId: string, generation: number): void;
  finish(sessionId: string, generation: number, status: "completed" | "failed", error: string | null): Promise<void>;
  fail(sessionId: string, generation: number, error: string): Promise<void>;
  isClosing(): boolean;
  notify(taskId: string): void;
}

export const toMaintenanceErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const maintenanceRelativePath = (root: MediaRoot, entry: LocalScanEntry): string =>
  entry.rootRef?.rootId === root.id ? entry.rootRef.relativePath : toRootRelativePath(root, entry.fileInfo.filePath);

export const scanMaintenanceRefs = async (
  runtime: MaintenanceRuntime,
  root: MediaRoot,
  refs: readonly MaintenanceTaskRef[],
  signal?: AbortSignal,
): Promise<LocalScanEntry[]> => {
  assertUniqueMaintenanceRefs(refs);
  const entries = await runtime.scanRefs({ root, refs: refs.map((ref) => ({ ...ref })), signal });
  const byPath = new Map<string, LocalScanEntry>();
  for (const entry of entries) {
    const relativePath = maintenanceRelativePath(root, entry);
    if (byPath.has(relativePath)) throw new Error(`维护扫描结果路径重复：${relativePath}`);
    byPath.set(relativePath, entry);
  }
  if (byPath.size !== refs.length || refs.some((ref) => !byPath.has(ref.relativePath))) {
    throw new Error("维护扫描结果与请求文件不一致");
  }
  return refs.map((ref) => byPath.get(ref.relativePath) as LocalScanEntry);
};
