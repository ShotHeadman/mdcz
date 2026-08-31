import { z } from "zod";
import type { Configuration, DeepPartial } from "./config";
import { Website } from "./enums";
import { assetRefSchema, parseWireRelativeDirectory, type RootFileRef, rootFileRefSchema } from "./mediaRef";
import { normalizedCropRegionSchema } from "./posterCrop";
import type { MediaCandidate } from "./types";

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
});

export type MediaRootCreateInput = z.infer<typeof mediaRootCreateInputSchema>;

export const mediaRootEnsurePathInputSchema = z.object({
  displayName: z.string().trim().min(1).optional(),
  hostPath: z.string().trim().min(1),
});

export type MediaRootEnsurePathInput = z.infer<typeof mediaRootEnsurePathInputSchema>;

export const mediaRootEnsurePathResponseSchema = mediaRootSchema.extend({
  relativeDirectory: z.string(),
});

export type MediaRootEnsurePathResponse = z.infer<typeof mediaRootEnsurePathResponseSchema>;

export const rootBrowserInputSchema = z.object({
  rootId: z.string().trim().min(1),
  relativePath: z.string().optional().default(""),
});

export type RootBrowserInput = z.input<typeof rootBrowserInputSchema>;

export type { RootFileRef } from "./mediaRef";

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

export const serverPathIntentSchema = z.enum(["settings", "workbench-scan", "workbench-output", "media-root"]);

export type ServerPathIntentDto = z.infer<typeof serverPathIntentSchema>;

export const serverPathSuggestInputSchema = z.object({
  path: z.string().optional().default(""),
  kind: z.literal("directory").optional().default("directory"),
  intent: serverPathIntentSchema.optional(),
});

export type ServerPathSuggestInput = z.input<typeof serverPathSuggestInputSchema>;

export const serverPathSuggestionEntrySchema = z.object({
  type: z.literal("directory"),
  name: z.string(),
  label: z.string(),
  path: z.string(),
});

export type ServerPathSuggestionEntryDto = z.infer<typeof serverPathSuggestionEntrySchema>;

export const serverPathSuggestResponseSchema = z.object({
  path: z.string(),
  parentPath: z.string(),
  exists: z.boolean(),
  accessible: z.boolean(),
  entries: z.array(serverPathSuggestionEntrySchema),
  error: z.string().optional(),
});

export type ServerPathSuggestResponse = z.infer<typeof serverPathSuggestResponseSchema>;

export const taskKindSchema = z.enum(["scan", "scrape", "maintenance"]);
export type TaskKind = z.infer<typeof taskKindSchema>;

export const scanStatusSchema = z.enum(["queued", "running", "completed", "failed", "paused", "stopping"]);
export type ScanStatus = z.infer<typeof scanStatusSchema>;

export const taskStatusSchema = z.enum([
  "queued",
  "running",
  "paused",
  "stopping",
  "completed",
  "failed",
  "stopped",
  "interrupted",
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const crawlerDataSchema = z.object({
  title: z.string(),
  original_title: z.string().optional(),
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
  website: z.nativeEnum(Website).optional(),
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
  continuity: z.enum(["live", "final", "interrupted"]).optional(),
});

export type ScanTaskDto = z.infer<typeof scanTaskSchema>;

export const scrapeRunTaskSchema = z.object({
  id: z.string(),
  kind: z.literal("scrape"),
  rootId: z.string(),
  rootDisplayName: z.string(),
  status: taskStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  totalItems: z.number().int().nonnegative(),
  successCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  error: z.string().nullable(),
  continuity: z.enum(["live", "final", "interrupted"]),
});

export type ScrapeRunTaskDto = z.infer<typeof scrapeRunTaskSchema>;

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

export const scanCandidatesInputSchema = z.object({
  excludeDirPaths: z.array(z.string().trim().min(1)).optional(),
  scanDir: z.string().trim().min(1),
  supportedExtensions: z.array(z.string().trim().min(1)).optional(),
});

export type ScanCandidatesInput = z.infer<typeof scanCandidatesInputSchema>;

export interface ScanCandidatesResponse {
  candidates: MediaCandidate[];
}

export const scrapeFileRefSchema = rootFileRefSchema;

export type ScrapeFileRefDto = RootFileRef;

export const ambiguousUncensoredItemSchema = z.object({
  id: z.string(),
  ref: scrapeFileRefSchema,
  fileId: z.string(),
  fileName: z.string(),
  number: z.string(),
  title: z.string().nullable(),
  nfoRelativePath: z.string().nullable(),
});

export type AmbiguousUncensoredItemDto = z.infer<typeof ambiguousUncensoredItemSchema>;

const scrapeBatchStartInputSchema = z.object({
  executionMode: z.literal("batch"),
  outputRootId: z.string().trim().min(1),
  outputRelativeDirectory: z.string().transform(parseWireRelativeDirectory).optional(),
  refs: z.array(scrapeFileRefSchema).min(1),
  maintenancePreset: maintenancePresetIdSchema.optional(),
  uncensoredConfirmed: z.boolean().optional(),
  manualUrl: z.string().trim().min(1).optional(),
});

const scrapeSingleStartInputSchema = z.object({
  executionMode: z.literal("single"),
  outputRootId: z.string().trim().min(1).optional(),
  outputRelativeDirectory: z.string().transform(parseWireRelativeDirectory).optional(),
  refs: z.array(scrapeFileRefSchema).length(1),
  maintenancePreset: maintenancePresetIdSchema.optional(),
  uncensoredConfirmed: z.boolean().optional(),
  manualUrl: z.string().trim().min(1).optional(),
});

export const scrapeStartInputSchema = z.discriminatedUnion("executionMode", [
  scrapeBatchStartInputSchema,
  scrapeSingleStartInputSchema,
]);

export type ScrapeStartInput = z.output<typeof scrapeStartInputSchema>;

export const scrapeTaskControlInputSchema = z.object({
  taskId: z.string().trim().min(1),
  itemIds: z.array(z.string().trim().min(1)).min(1).optional(),
});

export type ScrapeTaskControlInput = z.infer<typeof scrapeTaskControlInputSchema>;

export const scrapeConfirmUncensoredInputSchema = z.object({
  taskId: z.string().trim().min(1),
  refs: z.array(scrapeFileRefSchema).min(1).optional(),
  items: z
    .array(
      z.object({
        ref: scrapeFileRefSchema,
        choice: z.enum(["umr", "leak", "uncensored"]),
      }),
    )
    .min(1)
    .optional(),
});

export type ScrapeConfirmUncensoredInput = z.infer<typeof scrapeConfirmUncensoredInputSchema>;

export const scrapeResultIdInputSchema = z.object({
  id: z.string().trim().min(1),
});

export type ScrapeResultIdInput = z.infer<typeof scrapeResultIdInputSchema>;

export const posterCropSaveInputSchema = scrapeResultIdInputSchema.extend({
  crop: normalizedCropRegionSchema,
});

export type PosterCropSaveInput = z.infer<typeof posterCropSaveInputSchema>;

export const posterCropSessionResponseSchema = z.object({
  sourceRelativePath: z.string().trim().min(1),
  targetRelativePath: z.string().trim().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  initialCrop: normalizedCropRegionSchema,
  revision: z.string().optional(),
});

export type PosterCropSessionResponse = z.infer<typeof posterCropSessionResponseSchema>;

export const nfoReadInputSchema = z.object({
  rootId: z.string().trim().min(1),
  relativePath: z.string().trim().min(1),
  videoRelativePath: z.string().trim().min(1).optional(),
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
  outputRootId: z.string().nullable().optional(),
  relativePath: z.string(),
  fileName: z.string(),
  status: z.enum(["pending", "processing", "success", "failed", "skipped"]),
  error: z.string().nullable(),
  crawlerData: crawlerDataSchema.nullable(),
  nfoRootId: z.string().nullable(),
  nfoRelativePath: z.string().nullable(),
  outputRelativePath: z.string().nullable(),
  assets: z.array(assetRefSchema),
  manualUrl: z.string().nullable(),
  uncensoredAmbiguous: z.boolean().optional(),
  persistenceState: z.enum(["terminal", "interrupted"]).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ScrapeResultDto = z.infer<typeof scrapeResultSchema>;

/**
 * A live item belongs to an in-process scrape run.  Unlike ScrapeResultDto it
 * is not persisted history: its `id` is the stable manifest item id and it
 * can therefore describe pending and processing work as well as a committed
 * terminal outcome.
 */
export const scrapeLiveItemSchema = z.object({
  id: z.string(),
  resultId: z.string().nullable(),
  rootId: z.string(),
  relativePath: z.string(),
  fileName: z.string(),
  status: z.enum(["pending", "processing", "success", "failed", "skipped"]),
  error: z.string().nullable(),
  crawlerData: crawlerDataSchema.nullable(),
  nfoRootId: z.string().nullable(),
  nfoRelativePath: z.string().nullable(),
  outputRootId: z.string().nullable(),
  outputRelativePath: z.string().nullable(),
  assets: z.array(assetRefSchema),
  manualUrl: z.string().nullable(),
  uncensoredAmbiguous: z.boolean(),
});

export type ScrapeLiveItemDto = z.infer<typeof scrapeLiveItemSchema>;

export const scrapeResultListResponseSchema = z.object({
  results: z.array(scrapeResultSchema),
});

export type ScrapeResultListResponse = z.infer<typeof scrapeResultListResponseSchema>;

export const scrapeResultDetailResponseSchema = z.object({
  result: scrapeResultSchema,
});

export type ScrapeResultDetailResponse = z.infer<typeof scrapeResultDetailResponseSchema>;

export const scrapeHistoryRunSchema = z.object({
  id: z.string(),
  rootId: z.string(),
  rootDisplayName: z.string(),
  requestedOutputRootId: z.string().nullable(),
  outputRootId: z.string().nullable(),
  executionMode: z.enum(["single", "batch"]),
  disposition: z.enum(["completed", "failed", "stopped", "interrupted"]),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  successCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  totalBytes: z.number().nonnegative(),
  error: z.string().nullable(),
});

export type ScrapeHistoryRunDto = z.infer<typeof scrapeHistoryRunSchema>;

export const scrapeHistoryResponseSchema = z.object({
  runs: z.array(scrapeHistoryRunSchema),
  results: z.array(scrapeResultSchema),
});

export type ScrapeHistoryResponse = z.infer<typeof scrapeHistoryResponseSchema>;

export const nfoReadResponseSchema = z.object({
  rootId: z.string(),
  relativePath: z.string(),
  effectiveRelativePath: z.string(),
  exists: z.boolean(),
  data: crawlerDataSchema.nullable(),
});

export type NfoReadResponse = z.infer<typeof nfoReadResponseSchema>;

export const nfoWriteResponseSchema = z.object({
  rootId: z.string(),
  relativePath: z.string(),
  effectiveRelativePath: z.string(),
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

export const maintenanceStartInputSchema = z.object({
  rootId: z.string().trim().min(1),
  presetId: maintenancePresetIdSchema,
  refs: z.array(scrapeFileRefSchema).min(1),
});

export type MaintenanceStartInput = z.infer<typeof maintenanceStartInputSchema>;

export const maintenanceSessionInputSchema = z.object({
  sessionId: z.string().trim().min(1),
});

export type MaintenanceSessionInput = z.infer<typeof maintenanceSessionInputSchema>;

export const maintenanceUpdateDraftInputSchema = maintenanceSessionInputSchema.extend({
  previewId: z.string().min(1),
  fieldSelections: z.record(z.string(), z.enum(["old", "new"])).optional(),
});
export type MaintenanceUpdateDraftInput = z.infer<typeof maintenanceUpdateDraftInputSchema>;

export const maintenanceDiscardSessionInputSchema = z.object({ sessionId: z.string().min(1).optional() }).optional();
export type MaintenanceDiscardSessionInput = z.infer<typeof maintenanceDiscardSessionInputSchema>;

export const maintenanceMutationAckSchema = z.object({ sessionId: z.string() });
export type MaintenanceMutationAckDto = z.infer<typeof maintenanceMutationAckSchema>;

export const maintenanceApplyInputSchema = maintenanceSessionInputSchema.extend({
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

export const logEntrySchema = taskEventSchema.extend({
  source: z.enum(["task", "runtime"]),
  level: z.enum(["OK", "WARN", "ERR", "REQ", "INFO"]).optional(),
});

export type LogEntryDto = z.infer<typeof logEntrySchema>;

export const logListInputSchema = z
  .object({
    kind: z.enum(["all", "task", "runtime"]).optional(),
    taskIds: z.array(z.string().trim().min(1)).optional(),
  })
  .nullish();

export type LogListInput = z.infer<typeof logListInputSchema>;

export const logListResponseSchema = z.object({
  logs: z.array(logEntrySchema),
});

export type LogListResponse = z.infer<typeof logListResponseSchema>;

export const scrapeRunSnapshotSchema = z.object({
  task: scrapeRunTaskSchema,
  progress: z.object({
    percent: z.number().min(0).max(100),
    completedItems: z.number().int().nonnegative(),
    totalItems: z.number().int().nonnegative(),
  }),
  items: z.array(scrapeLiveItemSchema),
  latestStage: z
    .object({
      stage: z.string(),
      message: z.string(),
      relativePath: z.string().nullable(),
    })
    .nullable(),
  logs: z.array(logEntrySchema),
  ambiguousUncensoredItems: z.array(ambiguousUncensoredItemSchema),
});

export type ScrapeRunSnapshotDto = z.infer<typeof scrapeRunSnapshotSchema>;

export const scrapeLiveRunsResponseSchema = z.object({
  runs: z.array(scrapeRunSnapshotSchema),
});

export type ScrapeLiveRunsResponse = z.infer<typeof scrapeLiveRunsResponseSchema>;

export const scrapeMutationAckSchema = z.object({
  runId: z.string(),
});

export type ScrapeMutationAckDto = z.infer<typeof scrapeMutationAckSchema>;

export const scrapePendingUncensoredConfirmationItemSchema = ambiguousUncensoredItemSchema.extend({
  taskId: z.string(),
});

export type ScrapePendingUncensoredConfirmationItemDto = z.infer<typeof scrapePendingUncensoredConfirmationItemSchema>;

export const scrapePendingUncensoredConfirmationResponseSchema = z.object({
  items: z.array(scrapePendingUncensoredConfirmationItemSchema),
});

export type ScrapePendingUncensoredConfirmationResponse = z.infer<
  typeof scrapePendingUncensoredConfirmationResponseSchema
>;

export const taskNotificationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("invalidate"),
    resources: z.array(
      z.enum(["ready", "scan", "scrape-live", "scrape-history", "maintenance", "pending-confirmation"]),
    ),
  }),
  z.object({ kind: z.literal("log"), log: logEntrySchema }),
]);

export type TaskNotificationDto = z.infer<typeof taskNotificationSchema>;

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
  runId: z.string().nullable(),
  scrapeOutcomeId: z.string().nullable(),
  title: z.string().nullable(),
  number: z.string().nullable(),
  actors: z.array(z.string()),
  crawlerData: crawlerDataSchema.nullable(),
  thumbnailPath: z.string().nullable(),
  thumbnailRootId: z.string().nullable().optional(),
  lastKnownPath: z.string().nullable(),
  createdAt: z.string(),
  lastRefreshedAt: z.string().nullable(),
  hiddenFromRecentAt: z.string().nullable(),
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
    cursor: z.string().trim().min(1).max(2048).optional(),
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
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
  total: z.number(),
});

export type LibraryListResponse = z.infer<typeof libraryListResponseSchema>;

export const libraryAvailabilityInputSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(200),
});

export type LibraryAvailabilityInput = z.infer<typeof libraryAvailabilityInputSchema>;

export const libraryAvailabilityResponseSchema = z.object({
  entries: z.array(
    z.object({
      id: z.string(),
      available: z.boolean().nullable(),
      fileRefs: z.array(
        z.object({
          id: z.string(),
          available: z.boolean().nullable(),
        }),
      ),
    }),
  ),
});

export type LibraryAvailabilityResponse = z.infer<typeof libraryAvailabilityResponseSchema>;

export const libraryDetailResponseSchema = z.object({
  entry: libraryEntrySchema,
});

export type LibraryDetailResponse = z.infer<typeof libraryDetailResponseSchema>;

export const overviewRecentAcquisitionSchema = z.object({
  id: z.string(),
  rootId: z.string(),
  number: z.string(),
  title: z.string().nullable(),
  actors: z.array(z.string()),
  thumbnailPath: z.string().nullable(),
  thumbnailRootId: z.string().nullable().optional(),
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
  unresolvedRepairCount: z.number().int().nonnegative(),
});

export type OverviewOutputSummaryDto = z.infer<typeof overviewOutputSummarySchema>;

export const overviewSummaryResponseSchema = z.object({
  output: overviewOutputSummarySchema,
  recentAcquisitions: z.array(overviewRecentAcquisitionSchema),
});

export type OverviewSummaryResponse = z.infer<typeof overviewSummaryResponseSchema>;

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
  status: taskStatusSchema,
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

export const automationScrapeStartInputSchema = z
  .object({
    refs: z.array(scrapeFileRefSchema).min(1).optional(),
    rootId: z.string().trim().min(1).optional(),
    outputRootId: z.string().trim().min(1).optional(),
    outputRelativeDirectory: z.string().transform(parseWireRelativeDirectory).optional(),
    executionMode: z.enum(["single", "batch"]).default("batch"),
    manualUrl: z.string().trim().min(1).optional(),
    uncensoredConfirmed: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    if (value.refs?.length && value.executionMode === "batch" && !value.outputRootId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outputRootId"],
        message: "Batch scrapes require outputRootId",
      });
    }
  });

export type AutomationScrapeStartInput = z.infer<typeof automationScrapeStartInputSchema>;

export const automationScrapeStartResponseSchema = z.object({
  task: z.union([scanTaskSchema, scrapeRunTaskSchema]),
  webhook: automationWebhookEventSchema,
});

export type AutomationScrapeStartResponse = z.infer<typeof automationScrapeStartResponseSchema>;

export const appEnsureWatermarkDirectoryResponseSchema = z.object({
  path: z.string(),
});

export type AppEnsureWatermarkDirectoryResponse = z.infer<typeof appEnsureWatermarkDirectoryResponseSchema>;

export const crawlerSiteInfoSchema = z.object({
  site: z.nativeEnum(Website),
  name: z.string(),
  enabled: z.boolean(),
  native: z.boolean(),
});

export type CrawlerSiteInfoDto = z.infer<typeof crawlerSiteInfoSchema>;

export const crawlerListSitesResponseSchema = z.object({
  sites: z.array(crawlerSiteInfoSchema),
});

export type CrawlerListSitesResponse = z.infer<typeof crawlerListSitesResponseSchema>;

export const crawlerProbeSiteConnectivityInputSchema = z.object({
  site: z.nativeEnum(Website),
});

export type CrawlerProbeSiteConnectivityInput = z.infer<typeof crawlerProbeSiteConnectivityInputSchema>;

export const siteConnectivityProbeResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  latencyMs: z.number(),
  status: z.number().optional(),
  resolvedUrl: z.string().optional(),
});

export type SiteConnectivityProbeResponse = z.infer<typeof siteConnectivityProbeResponseSchema>;

export const networkCookieCheckStatusSchema = z.enum([
  "not_configured",
  "ready_without_cookie",
  "ready_with_cookie",
  "invalid_or_expired",
  "verification_required",
  "login_wall",
  "unexpected_page",
  "request_failed",
]);

export type NetworkCookieCheckStatus = z.infer<typeof networkCookieCheckStatusSchema>;

export const networkCheckCookiesResponseSchema = z.object({
  results: z.array(
    z.object({
      site: z.string(),
      valid: z.boolean(),
      message: z.string(),
      status: networkCookieCheckStatusSchema,
    }),
  ),
});

export type NetworkCheckCookiesResponse = z.infer<typeof networkCheckCookiesResponseSchema>;

export const translateTestLlmInputSchema = z.object({
  llmModelName: z.string().optional(),
  llmApiKey: z.string().optional(),
  llmBaseUrl: z.string().optional(),
  llmPrompt: z.string().optional(),
  llmTemperature: z.number().optional(),
  llmTimeout: z.number().optional(),
});

export type TranslateTestLlmInputDto = z.infer<typeof translateTestLlmInputSchema>;

export const translateTestLlmResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type TranslateTestLlmResponse = z.infer<typeof translateTestLlmResponseSchema>;

export const authLoginInputSchema = z.object({
  password: z.string(),
});

export type AuthLoginInput = z.infer<typeof authLoginInputSchema>;

export const setupCompleteInputSchema = z.object({
  // The server-side MDCZ_ADMIN_PASSWORD is used when configured, so the setup
  // wizard must be able to complete without sending a client-supplied value.
  password: z.string().min(1).optional(),
  mediaRoot: mediaRootCreateInputSchema,
});

export type SetupCompleteInput = z.infer<typeof setupCompleteInputSchema>;

export const authSessionSchema = z.object({
  authenticated: z.boolean(),
  token: z.string().optional(),
  setupRequired: z.boolean().optional(),
  usingDefaultPassword: z.boolean().optional(),
  environmentPasswordConfigured: z.boolean().optional(),
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

export const configPreviewInputSchema = z.record(z.string(), z.any());

export type ConfigPreviewInput = DeepPartial<Configuration>;

export const configUpdateInputSchema = z.record(z.string(), z.any());

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
  fileName: z.string().trim().min(1).optional(),
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
    toolId: z.literal("batch-nfo-translator"),
    action: z.enum(["translate-text", "scan", "apply"]).optional().default("translate-text"),
    text: z.string().trim().min(1).optional(),
    directory: z.string().trim().min(1).optional(),
    batchSize: z.number().int().min(1).max(20).optional(),
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

export type ToolExecuteInput = z.input<typeof toolExecuteInputSchema>;

export const toolExecuteResponseSchema = z.object({
  toolId: z.string(),
  ok: z.boolean(),
  message: z.string(),
  data: z.any().optional(),
});

export type ToolExecuteResponse = z.infer<typeof toolExecuteResponseSchema>;

export const setupStatusSchema = z.object({
  configured: z.boolean(),
  setupRequired: z.boolean(),
  mediaRootCount: z.number(),
  usingDefaultPassword: z.boolean(),
  environmentPasswordConfigured: z.boolean(),
});

export type SetupStatusDto = z.infer<typeof setupStatusSchema>;
