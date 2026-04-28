export type MediaRootType = "mounted-filesystem";

export interface MediaRootDto {
  id: string;
  displayName: string;
  hostPath: string;
  rootType: MediaRootType;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RootRelativeFileRefDto {
  rootId: string;
  relativePath: string;
}

export type TaskRecordStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export interface TaskSummaryDto {
  id: string;
  kind: string;
  status: TaskRecordStatus;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}
