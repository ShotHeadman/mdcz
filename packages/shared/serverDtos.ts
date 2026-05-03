import { z } from "zod";
import type { Configuration, DeepPartial } from "./config";
import { Website } from "./enums";

export const maintenancePresetIdSchema = z.enum(["read_local", "refresh_data", "organize_files", "rebuild_all"]);
export type MaintenancePresetIdDto = z.infer<typeof maintenancePresetIdSchema>;

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
  maintenancePreset: maintenancePresetIdSchema.optional(),
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

const maintenanceFieldDiffSchema = z
  .object({
    changed: z.boolean(),
    field: z.string(),
    kind: z.enum(["value", "image", "imageCollection"]),
    label: z.string(),
    newValue: z.unknown(),
    oldValue: z.unknown(),
  })
  .passthrough();

const maintenancePathDiffSchema = z.object({
  changed: z.boolean(),
  currentDir: z.string(),
  currentVideoPath: z.string(),
  fileId: z.string(),
  targetDir: z.string(),
  targetVideoPath: z.string(),
});

export const maintenancePreviewItemSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  presetId: maintenancePresetIdSchema,
  rootId: z.string(),
  rootDisplayName: z.string(),
  relativePath: z.string(),
  fileName: z.string(),
  status: z.enum(["ready", "blocked", "applied", "failed"]),
  error: z.string().nullable(),
  fieldDiffs: z.array(maintenanceFieldDiffSchema),
  unchangedFieldDiffs: z.array(maintenanceFieldDiffSchema),
  pathDiff: maintenancePathDiffSchema.nullable(),
  proposedCrawlerData: crawlerDataSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type MaintenancePreviewItemDto = z.infer<typeof maintenancePreviewItemSchema>;

export const maintenanceStartInputSchema = z.object({
  rootId: z.string().trim().min(1),
  presetId: maintenancePresetIdSchema,
  refs: z.array(scrapeFileRefSchema).optional(),
});

export type MaintenanceStartInput = z.infer<typeof maintenanceStartInputSchema>;

export const maintenanceTaskInputSchema = z.object({
  taskId: z.string().trim().min(1),
});

export type MaintenanceTaskInput = z.infer<typeof maintenanceTaskInputSchema>;

export const maintenanceApplyInputSchema = maintenanceTaskInputSchema.extend({
  confirmationToken: z.string().trim().min(1).optional(),
  previewIds: z.array(z.string().trim().min(1)).optional(),
  selections: z
    .array(
      z.object({
        previewId: z.string().trim().min(1),
        fieldSelections: z.record(z.string(), z.enum(["old", "new"])).optional(),
      }),
    )
    .optional(),
});

export type MaintenanceApplyInput = z.infer<typeof maintenanceApplyInputSchema>;

export const maintenancePreviewResponseSchema = z.object({
  task: scanTaskSchema,
  items: z.array(maintenancePreviewItemSchema),
  confirmationToken: z.string(),
});

export type MaintenancePreviewResponse = z.infer<typeof maintenancePreviewResponseSchema>;

export const maintenanceApplyLogSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  previewId: z.string(),
  rootId: z.string(),
  relativePath: z.string(),
  presetId: maintenancePresetIdSchema,
  status: z.enum(["success", "failed", "skipped"]),
  error: z.string().nullable(),
  appliedAt: z.string(),
});

export type MaintenanceApplyLogDto = z.infer<typeof maintenanceApplyLogSchema>;

export const maintenanceApplyResponseSchema = z.object({
  task: scanTaskSchema,
  items: z.array(maintenancePreviewItemSchema),
  applied: z.array(maintenanceApplyLogSchema),
});

export type MaintenanceApplyResponse = z.infer<typeof maintenanceApplyResponseSchema>;

export const logEntrySchema = taskEventSchema.extend({
  source: z.enum(["task", "runtime"]),
  level: z.enum(["OK", "WARN", "ERR", "REQ", "INFO"]).optional(),
});

export type LogEntryDto = z.infer<typeof logEntrySchema>;

export const logListInputSchema = z
  .object({
    kind: z.enum(["all", "task", "runtime"]).optional().default("all"),
  })
  .optional();

export type LogListInput = z.infer<typeof logListInputSchema>;

export const logListResponseSchema = z.object({
  logs: z.array(logEntrySchema),
});

export type LogListResponse = z.infer<typeof logListResponseSchema>;

export const libraryEntrySchema = z.object({
  id: z.string(),
  mediaIdentity: z.string().nullable(),
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
  crawlerData: crawlerDataSchema.nullable(),
  thumbnailPath: z.string().nullable(),
  lastKnownPath: z.string().nullable(),
  indexedAt: z.string(),
  lastRefreshedAt: z.string().nullable(),
  available: z.boolean().nullable(),
  fileRefs: z.array(
    z.object({
      id: z.string(),
      rootId: z.string(),
      rootDisplayName: z.string(),
      relativePath: z.string(),
      fileName: z.string(),
      directory: z.string(),
      size: z.number(),
      modifiedAt: z.string().nullable(),
      lastKnownPath: z.string().nullable(),
      available: z.boolean().nullable(),
    }),
  ),
  assets: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      uri: z.string(),
      rootId: z.string().nullable(),
      relativePath: z.string().nullable(),
    }),
  ),
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

export const libraryRelinkInputSchema = libraryDetailInputSchema.extend({
  rootId: z.string().trim().min(1),
  relativePath: z.string().trim().min(1),
});

export type LibraryRelinkInput = z.infer<typeof libraryRelinkInputSchema>;

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

export const aboutLinkSchema = z.object({
  label: z.string(),
  url: z.string(),
  description: z.string().optional(),
});

export type AboutLinkDto = z.infer<typeof aboutLinkSchema>;

export const systemAboutResponseSchema = z.object({
  productName: z.string(),
  version: z.string().nullable(),
  homepage: z.string().nullable(),
  repository: z.string().nullable(),
  build: z.object({
    mode: z.string(),
    server: z.string().nullable(),
    web: z.string().nullable(),
    node: z.string(),
    platform: z.string(),
    arch: z.string(),
  }),
  community: z.object({
    feedback: aboutLinkSchema,
    links: z.array(aboutLinkSchema),
  }),
});

export type SystemAboutResponse = z.infer<typeof systemAboutResponseSchema>;

export const automationWebhookEventSchema = z.object({
  taskId: z.string(),
  kind: taskKindSchema,
  status: scanStatusSchema,
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  summary: z.string(),
  errors: z.array(z.string()),
});

export type AutomationWebhookEventDto = z.infer<typeof automationWebhookEventSchema>;

export const automationRecentInputSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .optional();

export type AutomationRecentInput = z.infer<typeof automationRecentInputSchema>;

export const automationRecentResponseSchema = z.object({
  tasks: z.array(automationWebhookEventSchema),
});

export type AutomationRecentResponse = z.infer<typeof automationRecentResponseSchema>;

export const automationWebhookDeliveryStatusSchema = z.object({
  configured: z.boolean(),
  delivered: z.number(),
  failed: z.number(),
  lastAttemptAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  lastError: z.string().nullable(),
});

export type AutomationWebhookDeliveryStatusDto = z.infer<typeof automationWebhookDeliveryStatusSchema>;

export const automationWebhookDeliveryStatusResponseSchema = z.object({
  webhook: automationWebhookDeliveryStatusSchema,
});

export type AutomationWebhookDeliveryStatusResponse = z.infer<typeof automationWebhookDeliveryStatusResponseSchema>;

export const automationScrapeStartInputSchema = z.object({
  refs: z.array(scrapeFileRefSchema).min(1).optional(),
  rootId: z.string().trim().min(1).optional(),
  outputRootId: z.string().trim().min(1).optional(),
  manualUrl: z.string().trim().min(1).optional(),
  uncensoredConfirmed: z.boolean().optional(),
});

export type AutomationScrapeStartInput = z.infer<typeof automationScrapeStartInputSchema>;

export const automationScrapeStartResponseSchema = z.object({
  task: scanTaskSchema,
  webhook: automationWebhookEventSchema,
});

export type AutomationScrapeStartResponse = z.infer<typeof automationScrapeStartResponseSchema>;

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
  detail: z.record(z.string(), z.unknown()).optional(),
});

export type DiagnosticCheckDto = z.infer<typeof diagnosticCheckSchema>;

export const diagnosticsSummaryResponseSchema = z.object({
  checks: z.array(diagnosticCheckSchema),
});

export type DiagnosticsSummaryResponse = z.infer<typeof diagnosticsSummaryResponseSchema>;

export const toolCatalogResponseSchema = z.object({
  tools: z.array(
    z.object({
      id: z.string(),
    }),
  ),
});

export type ToolCatalogResponse = z.infer<typeof toolCatalogResponseSchema>;

export const toolExecuteInputSchema = z.discriminatedUnion("toolId", [
  z.object({
    toolId: z.literal("single-file-scraper"),
    rootId: z.string().trim().min(1),
    relativePath: z.string().trim().min(1),
    manualUrl: z.string().trim().min(1).optional(),
  }),
  z.object({
    toolId: z.literal("crawler-tester"),
    number: z.string().trim().min(1),
    site: z.nativeEnum(Website).optional(),
    manualUrl: z.string().trim().min(1).optional(),
  }),
  z.object({
    toolId: z.literal("media-library-tools"),
    server: z.enum(["emby", "jellyfin"]).default("jellyfin"),
    action: z.enum(["check", "sync-info", "sync-photo"]).optional().default("check"),
    mode: z.enum(["all", "missing"]).optional().default("missing"),
  }),
  z.object({
    toolId: z.literal("symlink-manager"),
    sourceDir: z.string().trim().min(1),
    destDir: z.string().trim().min(1),
    copyFiles: z.boolean().optional(),
    dryRun: z.boolean().optional(),
  }),
  z.object({
    toolId: z.literal("file-cleaner"),
    rootId: z.string().trim().min(1),
    relativePath: z.string().optional().default(""),
    extensions: z.array(z.string().trim().min(1)).min(1),
    dryRun: z.boolean().optional().default(true),
  }),
  z.object({
    toolId: z.literal("batch-nfo-translator"),
    action: z.enum(["translate-text", "scan", "apply"]).optional().default("translate-text"),
    text: z.string().trim().min(1).optional(),
    directory: z.string().trim().min(1).optional(),
    items: z
      .array(
        z.object({
          filePath: z.string().trim().min(1),
          nfoPath: z.string().trim().min(1),
          directory: z.string().trim().min(1),
          number: z.string(),
          title: z.string(),
          pendingFields: z.array(z.enum(["title", "plot"])),
        }),
      )
      .optional(),
  }),
  z.object({
    toolId: z.literal("missing-number-finder"),
    prefix: z.string().optional().default(""),
    start: z.number().int(),
    end: z.number().int(),
    existing: z.array(z.string()).default([]),
  }),
  z.object({
    toolId: z.literal("amazon-poster"),
    action: z.enum(["scan", "lookup", "apply"]).optional().default("scan"),
    rootDir: z.string().trim().min(1).optional(),
    nfoPath: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).optional(),
    items: z
      .array(
        z.object({
          nfoPath: z.string().trim().min(1),
          amazonPosterUrl: z.string().trim().min(1),
        }),
      )
      .optional(),
  }),
]);

export type ToolExecuteInput = z.infer<typeof toolExecuteInputSchema>;

export const toolExecuteResponseSchema = z.object({
  toolId: z.string(),
  ok: z.boolean(),
  message: z.string(),
  data: z.unknown().optional(),
});

export type ToolExecuteResponse = z.infer<typeof toolExecuteResponseSchema>;

export const setupStatusSchema = z.object({
  configured: z.boolean(),
  setupRequired: z.boolean(),
  mediaRootCount: z.number(),
  usingDefaultPassword: z.boolean(),
  environmentPassword: z.string().optional(),
});

export type SetupStatusDto = z.infer<typeof setupStatusSchema>;
