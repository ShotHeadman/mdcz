import type { ServiceContainer } from "@main/container";
import { createMaintenanceHandlers } from "@main/ipc/handlers/maintenance";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { LocalScanEntry } from "@mdcz/shared/types";
import { describe, expect, it, vi } from "vitest";

vi.mock("@egoist/tipc/main", () => {
  type MockProcedure = {
    input: () => MockProcedure;
    action: <TInput, TResult>(
      action: (args: { context: unknown; input: TInput }) => Promise<TResult>,
    ) => {
      action: (args: { context: unknown; input: TInput }) => Promise<TResult>;
    };
  };
  const createProcedure = (): MockProcedure => ({
    input: () => createProcedure(),
    action: (action) => ({ action }),
  });
  return { tipc: { create: () => ({ procedure: createProcedure() }) } };
});

const entry: LocalScanEntry = {
  fileId: "file-1",
  fileInfo: {
    filePath: "/media/file-1.mp4",
    fileName: "file-1.mp4",
    extension: ".mp4",
    number: "FILE-1",
    isSubtitled: false,
  },
  assets: { sceneImages: [], actorPhotos: [] },
  currentDir: "/media",
};

const task = {
  id: "task-1",
  rootId: "root-1",
  status: "completed" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  startedAt: new Date(),
  completedAt: new Date(),
  error: null,
  totalEntries: 1,
  completedEntries: 1,
  successCount: 1,
  failedCount: 0,
};

const batch = {
  task,
  items: [
    {
      id: "preview-1",
      taskId: task.id,
      rootId: task.rootId,
      relativePath: "file-1.mp4",
      presetId: "organize_files" as const,
      status: "ready" as const,
      error: null,
      fieldDiffs: [],
      unchangedFieldDiffs: [],
      pathDiff: null,
      proposedCrawlerData: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
};

describe("maintenance IPC task adapter", () => {
  it("uses one active maintenance session across IPC commands", async () => {
    let releasePreview!: () => void;
    const previewCompletion = new Promise<typeof batch>((resolve) => {
      releasePreview = () => resolve(batch);
    });
    const service = {
      scanFiles: vi.fn(async () => [entry]),
      scan: vi.fn(async () => [entry]),
      preview: vi.fn(async () => {
        await previewCompletion;
        return { items: [{ fileId: entry.fileId, previewId: "preview-1", taskId: task.id, status: "ready" as const }] };
      }),
      getActiveSession: vi.fn(async () => ({
        id: task.id,
      })),
      resolveActiveTaskId: vi.fn(async (preferred?: string) => preferred ?? task.id),
      execute: vi.fn(async () => ({ task, completion: Promise.resolve({ ...batch, applied: [] }) })),
      stop: vi.fn(async () => undefined),
      pause: vi.fn(async () => undefined),
      resume: vi.fn(async () => undefined),
      getStatus: vi.fn(async () => ({
        state: "idle" as const,
        totalEntries: 0,
        completedEntries: 0,
        successCount: 0,
        failedCount: 0,
      })),
    };
    const handlers = createMaintenanceHandlers({ maintenanceService: service } as unknown as ServiceContainer);
    const args = { context: { sender: {} as never } };

    await expect(
      handlers[IpcChannel.Maintenance_Scan].action({ ...args, input: { filePaths: [entry.fileInfo.filePath] } }),
    ).resolves.toEqual({ entries: [entry] });

    const previewResponse = handlers[IpcChannel.Maintenance_Preview].action({
      ...args,
      input: { entries: [entry], presetId: "organize_files" },
    });
    await vi.waitFor(() => expect(service.preview).toHaveBeenCalledOnce());
    await expect(handlers[IpcChannel.Maintenance_Pause].action({ ...args, input: undefined })).resolves.toEqual({
      success: true,
    });
    expect(service.pause).toHaveBeenCalledWith(task.id);
    releasePreview();
    await expect(previewResponse).resolves.toEqual({
      items: [{ fileId: entry.fileId, previewId: "preview-1", taskId: task.id, status: "ready" }],
    });

    await expect(
      handlers[IpcChannel.Maintenance_Execute].action({
        ...args,
        input: { items: [{ entry }], presetId: "organize_files" },
      }),
    ).resolves.toEqual({ success: true });
    expect(service.execute).toHaveBeenCalledWith(task.id, [{ entry }], "organize_files");

    await expect(handlers[IpcChannel.Maintenance_Stop].action({ ...args, input: undefined })).resolves.toEqual({
      success: true,
    });
    await expect(handlers[IpcChannel.Maintenance_Resume].action({ ...args, input: undefined })).resolves.toEqual({
      success: true,
    });
    expect(service.stop).toHaveBeenCalledWith(task.id);
    expect(service.resume).toHaveBeenCalledWith(task.id);
  });
});
