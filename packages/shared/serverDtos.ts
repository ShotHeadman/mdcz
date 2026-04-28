import { z } from "zod";

export const mediaRootSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  enabled: z.boolean(),
  deleted: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type MediaRootDto = z.infer<typeof mediaRootSchema>;

export const mediaRootListResponseSchema = z.object({
  roots: z.array(mediaRootSchema),
});

export type MediaRootListResponse = z.infer<typeof mediaRootListResponseSchema>;

export const mediaRootCreateInputSchema = z.object({
  name: z.string().trim().min(1),
  path: z.string().trim().min(1),
  enabled: z.boolean().optional(),
});

export type MediaRootCreateInput = z.infer<typeof mediaRootCreateInputSchema>;

export const mediaRootUpdateInputSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  path: z.string().trim().min(1).optional(),
  enabled: z.boolean().optional(),
});

export type MediaRootUpdateInput = z.infer<typeof mediaRootUpdateInputSchema>;

export const mediaRootIdInputSchema = z.object({
  id: z.string().trim().min(1),
});

export type MediaRootIdInput = z.infer<typeof mediaRootIdInputSchema>;

export const rootBrowserInputSchema = z.object({
  rootId: z.string().trim().min(1),
  relativePath: z.string().optional().default(""),
});

export type RootBrowserInput = z.infer<typeof rootBrowserInputSchema>;

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

export const scanStatusSchema = z.enum(["queued", "running", "completed", "failed"]);
export type ScanStatus = z.infer<typeof scanStatusSchema>;

export const scanTaskSchema = z.object({
  id: z.string(),
  rootId: z.string(),
  status: scanStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
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

export const taskEventListResponseSchema = z.object({
  events: z.array(taskEventSchema),
});

export type TaskEventListResponse = z.infer<typeof taskEventListResponseSchema>;

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

export const authSessionSchema = z.object({
  authenticated: z.boolean(),
  token: z.string().optional(),
});

export type AuthSessionDto = z.infer<typeof authSessionSchema>;

export const persistenceStatusSchema = z.object({
  ok: z.boolean(),
  path: z.string(),
});

export type PersistenceStatusDto = z.infer<typeof persistenceStatusSchema>;

export const setupStatusSchema = z.object({
  configured: z.boolean(),
  mediaRootCount: z.number(),
});

export type SetupStatusDto = z.infer<typeof setupStatusSchema>;
