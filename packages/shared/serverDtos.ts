import { z } from "zod";
import type { Configuration, DeepPartial } from "./config";

export const mediaRootAvailabilitySchema = z.object({
  available: z.boolean(),
  checkedAt: z.string(),
  error: z.string().nullable(),
});

export type MediaRootAvailabilityDto = z.infer<typeof mediaRootAvailabilitySchema>;

export const mediaRootSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  hostPath: z.string(),
  rootType: z.literal("mounted-filesystem"),
  enabled: z.boolean(),
  deleted: z.boolean(),
  availability: mediaRootAvailabilitySchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type MediaRootDto = z.infer<typeof mediaRootSchema>;

export const mediaRootListResponseSchema = z.object({
  roots: z.array(mediaRootSchema),
});

export type MediaRootListResponse = z.infer<typeof mediaRootListResponseSchema>;

export const mediaRootCreateInputSchema = z.object({
  displayName: z.string().trim().min(1),
  hostPath: z.string().trim().min(1),
  enabled: z.boolean().optional(),
});

export type MediaRootCreateInput = z.infer<typeof mediaRootCreateInputSchema>;

export const mediaRootUpdateInputSchema = z.object({
  id: z.string().trim().min(1),
  displayName: z.string().trim().min(1).optional(),
  hostPath: z.string().trim().min(1).optional(),
  enabled: z.boolean().optional(),
});

export type MediaRootUpdateInput = z.infer<typeof mediaRootUpdateInputSchema>;

export const mediaRootIdInputSchema = z.object({
  id: z.string().trim().min(1),
});

export type MediaRootIdInput = z.infer<typeof mediaRootIdInputSchema>;

export const mediaRootAvailabilityResponseSchema = z.object({
  root: mediaRootSchema,
  availability: mediaRootAvailabilitySchema,
});

export type MediaRootAvailabilityResponse = z.infer<typeof mediaRootAvailabilityResponseSchema>;

export const rootBrowserInputSchema = z.object({
  rootId: z.string().trim().min(1),
  relativePath: z.string().optional().default(""),
});

export type RootBrowserInput = z.infer<typeof rootBrowserInputSchema>;

export interface RootRelativeFileRefDto {
  rootId: string;
  relativePath: string;
}

export const rootBrowserEntrySchema = z.object({
  type: z.enum(["directory", "file"]),
  name: z.string(),
  relativePath: z.string(),
  size: z.number().optional(),
  lastModified: z.string().nullable(),
  classification: z.enum(["video", "non-video"]).optional(),
});

export type RootBrowserEntryDto = z.infer<typeof rootBrowserEntrySchema>;

export const rootBrowserResponseSchema = z.object({
  root: mediaRootSchema,
  relativePath: z.string(),
  entries: z.array(rootBrowserEntrySchema),
});

export type RootBrowserResponse = z.infer<typeof rootBrowserResponseSchema>;

export const taskKindSchema = z.enum(["scan"]);
export type TaskKind = z.infer<typeof taskKindSchema>;

export const scanStatusSchema = z.enum(["queued", "running", "completed", "failed"]);
export type ScanStatus = z.infer<typeof scanStatusSchema>;

export const scanTaskSchema = z.object({
  id: z.string(),
  kind: taskKindSchema,
  rootId: z.string(),
  rootDisplayName: z.string(),
  status: scanStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  videoCount: z.number(),
  directoryCount: z.number(),
  error: z.string().nullable(),
  videos: z.array(z.string()).optional(),
});

export type ScanTaskDto = z.infer<typeof scanTaskSchema>;

export const scanTaskListResponseSchema = z.object({
  tasks: z.array(scanTaskSchema),
});

export type ScanTaskListResponse = z.infer<typeof scanTaskListResponseSchema>;

export const scanTaskIdInputSchema = z.object({
  taskId: z.string().trim().min(1),
});

export type ScanTaskIdInput = z.infer<typeof scanTaskIdInputSchema>;

export const scanStartInputSchema = z.object({
  rootId: z.string().trim().min(1),
});

export type ScanStartInput = z.infer<typeof scanStartInputSchema>;

export const taskEventSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  type: z.string(),
  message: z.string(),
  createdAt: z.string(),
});

export type TaskEventDto = z.infer<typeof taskEventSchema>;

export const scanTaskDetailResponseSchema = z.object({
  task: scanTaskSchema,
  events: z.array(taskEventSchema),
});

export type ScanTaskDetailResponse = z.infer<typeof scanTaskDetailResponseSchema>;

export const taskEventListResponseSchema = z.object({
  events: z.array(taskEventSchema),
});

export type TaskEventListResponse = z.infer<typeof taskEventListResponseSchema>;

export const logEntrySchema = taskEventSchema.extend({
  source: z.literal("task"),
});

export type LogEntryDto = z.infer<typeof logEntrySchema>;

export const logListResponseSchema = z.object({
  logs: z.array(logEntrySchema),
});

export type LogListResponse = z.infer<typeof logListResponseSchema>;

export const libraryEntrySchema = z.object({
  id: z.string(),
  rootId: z.string(),
  rootDisplayName: z.string(),
  relativePath: z.string(),
  fileName: z.string(),
  directory: z.string(),
  size: z.number(),
  modifiedAt: z.string().nullable(),
  taskId: z.string(),
  scannedAt: z.string(),
});

export type LibraryEntryDto = z.infer<typeof libraryEntrySchema>;

export const libraryListInputSchema = z
  .object({
    query: z.string().optional(),
    rootId: z.string().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .optional();

export type LibraryListInput = z.infer<typeof libraryListInputSchema>;

export const libraryListResponseSchema = z.object({
  entries: z.array(libraryEntrySchema),
  total: z.number(),
});

export type LibraryListResponse = z.infer<typeof libraryListResponseSchema>;

export const webTaskUpdateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task"), task: scanTaskSchema }),
  z.object({ kind: z.literal("event"), event: taskEventSchema }),
  z.object({ kind: z.literal("snapshot"), tasks: z.array(scanTaskSchema) }),
]);

export type WebTaskUpdateDto = z.infer<typeof webTaskUpdateSchema>;

export const healthResponseSchema = z.object({
  service: z.string(),
  status: z.string(),
  slice: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const authLoginInputSchema = z.object({
  password: z.string(),
});

export type AuthLoginInput = z.infer<typeof authLoginInputSchema>;

export const setupCompleteInputSchema = z.object({
  password: z.string().min(1),
  mediaRoot: mediaRootCreateInputSchema,
});

export type SetupCompleteInput = z.infer<typeof setupCompleteInputSchema>;

export const authSessionSchema = z.object({
  authenticated: z.boolean(),
  token: z.string().optional(),
  setupRequired: z.boolean().optional(),
  usingDefaultPassword: z.boolean().optional(),
  environmentPassword: z.string().optional(),
});

export type AuthSessionDto = z.infer<typeof authSessionSchema>;

export const persistenceStatusSchema = z.object({
  ok: z.boolean(),
  path: z.string(),
});

export type PersistenceStatusDto = z.infer<typeof persistenceStatusSchema>;

export const configPathInputSchema = z
  .object({
    path: z.string().trim().min(1).optional(),
  })
  .optional();

export type ConfigPathInput = z.infer<typeof configPathInputSchema>;

export const configPreviewInputSchema = z.record(z.string(), z.unknown());

export type ConfigPreviewInput = DeepPartial<Configuration>;

export const configUpdateInputSchema = z.record(z.string(), z.unknown());

export type ConfigUpdateInput = DeepPartial<Configuration>;

export const configImportInputSchema = z.object({
  content: z.string().min(1),
});

export type ConfigImportInput = z.infer<typeof configImportInputSchema>;

export const diagnosticCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  ok: z.boolean(),
  message: z.string(),
  checkedAt: z.string(),
});

export type DiagnosticCheckDto = z.infer<typeof diagnosticCheckSchema>;

export const diagnosticsSummaryResponseSchema = z.object({
  checks: z.array(diagnosticCheckSchema),
});

export type DiagnosticsSummaryResponse = z.infer<typeof diagnosticsSummaryResponseSchema>;

export const setupStatusSchema = z.object({
  configured: z.boolean(),
  setupRequired: z.boolean(),
  mediaRootCount: z.number(),
  usingDefaultPassword: z.boolean(),
  environmentPassword: z.string().optional(),
});

export type SetupStatusDto = z.infer<typeof setupStatusSchema>;
