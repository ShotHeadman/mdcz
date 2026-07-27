import type { MediaRootDto, ScanTaskDto } from "@mdcz/shared/serverDtos";

const baselineTimestamp = "2026-01-01T00:00:00.000Z";

export const buildMediaRootDto = (overrides: Partial<MediaRootDto> = {}): MediaRootDto => ({
  id: "root-1",
  displayName: "Test Library",
  hostPath: "/media/test-library",
  rootType: "mounted-filesystem",
  enabled: true,
  deleted: false,
  createdAt: baselineTimestamp,
  updatedAt: baselineTimestamp,
  ...overrides,
});

export const buildScanTaskDto = (overrides: Partial<ScanTaskDto> = {}): ScanTaskDto => ({
  id: "task-1",
  kind: "scan",
  rootId: "root-1",
  rootDisplayName: "Test Library",
  status: "completed",
  createdAt: baselineTimestamp,
  updatedAt: baselineTimestamp,
  startedAt: baselineTimestamp,
  completedAt: baselineTimestamp,
  videoCount: 1,
  directoryCount: 1,
  error: null,
  ...overrides,
});
