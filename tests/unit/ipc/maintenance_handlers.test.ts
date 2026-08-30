import type { ServiceContainer } from "@main/container";
import { createMaintenanceHandlers } from "@main/ipc/handlers/maintenance";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { LocalScanEntry } from "@mdcz/shared/types";
import { describe, expect, it, vi } from "vitest";
import { ipcActionArgs } from "./ipcActionArgs";

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
  ref: { rootId: "test-root", relativePath: "test.mp4" },
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

const session = {
  id: "session-1",
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
  session,
  items: [
    {
      id: "preview-1",
      sessionId: session.id,
      rootId: session.rootId,
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
      startPreview: vi.fn(async () => ({ session, completion: previewCompletion })),
      getActiveSession: vi.fn(async () => ({
        id: session.id,
      })),
      resolveActiveSessionId: vi.fn(async (preferred?: string) => preferred ?? session.id),
      execute: vi.fn(async () => ({ session, completion: Promise.resolve({ ...batch, applied: [] }) })),
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
    const args = ipcActionArgs(undefined);
    const withInput = <T>(input: T) => ipcActionArgs(input);

    const previewResponse = handlers[IpcChannel.Maintenance_StartPreview].action(
      withInput({ refs: [entry.ref], presetId: "organize_files" }),
    );
    await vi.waitFor(() => expect(service.startPreview).toHaveBeenCalledOnce());
    await expect(handlers[IpcChannel.Maintenance_Pause].action(args)).resolves.toEqual({
      success: true,
    });
    expect(service.pause).toHaveBeenCalledWith(session.id);
    await expect(previewResponse).resolves.toEqual({ sessionId: session.id });
    releasePreview();

    const selections = [{ previewId: "preview-1", fieldSelections: { title: "old" as const } }];
    await expect(
      handlers[IpcChannel.Maintenance_Apply].action(withInput({ selections, presetId: "organize_files" })),
    ).resolves.toEqual({ sessionId: session.id });
    expect(service.execute).toHaveBeenCalledWith(session.id, selections, "organize_files");

    await expect(handlers[IpcChannel.Maintenance_Stop].action(args)).resolves.toEqual({
      success: true,
    });
    await expect(handlers[IpcChannel.Maintenance_Resume].action(args)).resolves.toEqual({
      success: true,
    });
    expect(service.stop).toHaveBeenCalledWith(session.id);
    expect(service.resume).toHaveBeenCalledWith(session.id);
  });
});
