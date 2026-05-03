import { z } from "zod";
import type { Configuration, DeepPartial } from "./config";
import { Website } from "./enums";

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

export const taskKindSchema = z.enum(["scan", "scrape", "maintenance"]);
export type TaskKind = z.infer<typeof taskKindSchema>;

export const scanStatusSchema = z.enum(["queued", "running", "completed", "failed", "paused", "stopping"]);
export type ScanStatus = z.infer<typeof scanStatusSchema>;

export const crawlerDataSchema = z.object({
  title: z.string(),
  title_zh: z.string().optional(),
  number: z.string(),
  actors: z.array(z.string()),
  actor_profiles: z
    .array(
      z.object({
        name: z.string(),
        aliases: z.array(z.string()).optional(),
        gender: z.string().optional(),
        birth_date: z.string().optional(),
        birth_place: z.string().optional(),
        blood_type: z.string().optional(),
        description: z.string().optional(),
        photo_url: z.string().optional(),
        height_cm: z.number().optional(),
        bust_cm: z.number().optional(),
        waist_cm: z.number().optional(),
        hip_cm: z.number().optional(),
        cup_size: z.string().optional(),
      }),
    )
    .optional(),
  genres: z.array(z.string()),
  content_type: z.string().optional(),
  studio: z.string().optional(),
  director: z.string().optional(),
  publisher: z.string().optional(),
  series: z.string().optional(),
  plot: z.string().optional(),
  plot_zh: z.string().optional(),
  release_date: z.string().optional(),
  durationSeconds: z.number().optional(),
  rating: z.number().optional(),
  thumb_url: z.string().optional(),
  poster_url: z.string().optional(),
  fanart_url: z.string().optional(),
  thumb_source_url: z.string().optional(),
  poster_source_url: z.string().optional(),
  fanart_source_url: z.string().optional(),
  trailer_source_url: z.string().optional(),
  scene_images: z.array(z.string()),
  trailer_url: z.string().optional(),
  website: z.nativeEnum(Website),
});

export type CrawlerDataDto = z.infer<typeof crawlerDataSchema>;

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

export const scrapeFileRefSchema = z.object({
  rootId: z.string().trim().min(1),
  relativePath: z.string().trim().min(1),
});

export type ScrapeFileRefDto = z.infer<typeof scrapeFileRefSchema>;

export const scrapeStartInputSchema = z.object({
  outputRootId: z.string().trim().min(1).optional(),
  refs: z.array(scrapeFileRefSchema).min(1),
  maintenancePreset: z.enum(["read_local", "refresh_data", "organize_files", "rebuild_all"]).optional(),
  uncensoredConfirmed: z.boolean().optional(),
  manualUrl: z.string().trim().min(1).optional(),
});

export type ScrapeStartInput = z.infer<typeof scrapeStartInputSchema>;

export const scrapeTaskControlInputSchema = z.object({
  taskId: z.string().trim().min(1),
});

export type ScrapeTaskControlInput = z.infer<typeof scrapeTaskControlInputSchema>;

export const scrapeResultIdInputSchema = z.object({
  id: z.string().trim().min(1),
});

export type ScrapeResultIdInput = z.infer<typeof scrapeResultIdInputSchema>;

export const nfoReadInputSchema = z.object({
  rootId: z.string().trim().min(1),
  relativePath: z.string().trim().min(1),
});

export type NfoReadInput = z.infer<typeof nfoReadInputSchema>;

export const nfoWriteInputSchema = nfoReadInputSchema.extend({
  data: crawlerDataSchema,
});

export type NfoWriteInput = z.infer<typeof nfoWriteInputSchema>;

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

export const scrapeResultSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  rootId: z.string(),
  rootDisplayName: z.string(),
  relativePath: z.string(),
  fileName: z.string(),
  status: z.enum(["pending", "processing", "success", "failed", "skipped"]),
  error: z.string().nullable(),
  crawlerData: crawlerDataSchema.nullable(),
  nfoRelativePath: z.string().nullable(),
  outputRelativePath: z.string().nullable(),
  manualUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ScrapeResultDto = z.infer<typeof scrapeResultSchema>;

export const scrapeResultListResponseSchema = z.object({
  results: z.array(scrapeResultSchema),
});

export type ScrapeResultListResponse = z.infer<typeof scrapeResultListResponseSchema>;

export const scrapeResultDetailResponseSchema = z.object({
  result: scrapeResultSchema,
});

export type ScrapeResultDetailResponse = z.infer<typeof scrapeResultDetailResponseSchema>;

export const nfoReadResponseSchema = z.object({
  rootId: z.string(),
  relativePath: z.string(),
  exists: z.boolean(),
  data: crawlerDataSchema.nullable(),
});

export type NfoReadResponse = z.infer<typeof nfoReadResponseSchema>;

export const nfoWriteResponseSchema = z.object({
  rootId: z.string(),
  relativePath: z.string(),
  data: crawlerDataSchema,
});

export type NfoWriteResponse = z.infer<typeof nfoWriteResponseSchema>;

export const fileActionInputSchema = z.object({
  rootId: z.string().trim().min(1),
  relativePath: z.string().trim().min(1),
});

export type FileActionInput = z.infer<typeof fileActionInputSchema>;

export const fileActionResponseSchema = z.object({
  ok: z.boolean(),
  rootId: z.string(),
  relativePath: z.string(),
});

export type FileActionResponse = z.infer<typeof fileActionResponseSchema>;

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
  taskId: z.string().nullable(),
  scrapeOutputId: z.string().nullable(),
  title: z.string().nullable(),
  number: z.string().nullable(),
  actors: z.array(z.string()),
  thumbnailPath: z.string().nullable(),
  lastKnownPath: z.string().nullable(),
  indexedAt: z.string(),
  available: z.boolean().nullable(),
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

export const libraryDetailInputSchema = z.object({
  id: z.string().trim().min(1),
});

export type LibraryDetailInput = z.infer<typeof libraryDetailInputSchema>;

export const libraryListResponseSchema = z.object({
  entries: z.array(libraryEntrySchema),
  total: z.number(),
});

export type LibraryListResponse = z.infer<typeof libraryListResponseSchema>;

export const libraryDetailResponseSchema = z.object({
  entry: libraryEntrySchema,
});

export type LibraryDetailResponse = z.infer<typeof libraryDetailResponseSchema>;

export const overviewRecentAcquisitionSchema = z.object({
  id: z.string(),
  number: z.string(),
  title: z.string().nullable(),
  actors: z.array(z.string()),
  thumbnailPath: z.string().nullable(),
  lastKnownPath: z.string().nullable(),
  completedAt: z.string(),
  available: z.boolean().nullable(),
});

export type OverviewRecentAcquisitionDto = z.infer<typeof overviewRecentAcquisitionSchema>;

export const overviewOutputSummarySchema = z.object({
  fileCount: z.number(),
  totalBytes: z.number(),
  outputAt: z.string().nullable(),
  rootPath: z.string().nullable(),
});

export type OverviewOutputSummaryDto = z.infer<typeof overviewOutputSummarySchema>;

export const overviewSummaryResponseSchema = z.object({
  output: overviewOutputSummarySchema,
  recentAcquisitions: z.array(overviewRecentAcquisitionSchema),
});

export type OverviewSummaryResponse = z.infer<typeof overviewSummaryResponseSchema>;

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

const profileNameSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[\p{L}\p{N}_-]+$/u, '档案名仅支持字母、数字、"_" 和 "-"');

export const configProfileNameInputSchema = z.object({
  name: profileNameSchema,
});

export type ConfigProfileNameInput = z.infer<typeof configProfileNameInputSchema>;

export const configProfileImportInputSchema = z.object({
  name: profileNameSchema,
  content: z.string().min(1),
  overwrite: z.boolean().optional(),
});

export type ConfigProfileImportInput = z.infer<typeof configProfileImportInputSchema>;

export const configProfileListResponseSchema = z.object({
  profiles: z.array(z.string()),
  active: z.string(),
});

export type ConfigProfileListResponse = z.infer<typeof configProfileListResponseSchema>;

export const configProfileExportResponseSchema = z.object({
  profileName: z.string(),
  fileName: z.string(),
  content: z.string(),
});

export type ConfigProfileExportResponse = z.infer<typeof configProfileExportResponseSchema>;

export const configProfileImportResponseSchema = z.object({
  profileName: z.string(),
  overwritten: z.boolean(),
  active: z.boolean(),
});

export type ConfigProfileImportResponse = z.infer<typeof configProfileImportResponseSchema>;

export const configProfileNameResponseSchema = z.object({
  profileName: z.string(),
});

export type ConfigProfileNameResponse = z.infer<typeof configProfileNameResponseSchema>;

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
