import { Website } from "@mdcz/shared/enums";
import { localFileTargetSchema, rootFileRefSchema } from "@mdcz/shared/mediaRef";
import { normalizedCropRegionSchema } from "@mdcz/shared/posterCrop";
import {
  configPathInputSchema,
  crawlerDataSchema,
  libraryAvailabilityInputSchema,
  libraryDetailInputSchema,
  libraryListInputSchema,
  maintenancePresetIdSchema,
  mediaRootEnsurePathInputSchema,
} from "@mdcz/shared/serverDtos";
import { z } from "zod";

const optionalString = z.string().optional();
const optionalPathList = z.array(z.string()).optional();

export const appOpenExternalInputSchema = z.object({ url: z.string().min(1) });
export const appPlayMediaInputSchema = z.object({ path: localFileTargetSchema });
export const appShowItemInFolderInputSchema = z.object({ path: localFileTargetSchema });
export const appSyncTitleBarThemeInputSchema = z.object({ isDark: z.boolean() });

export const configSaveInputSchema = z.object({ config: z.record(z.string(), z.unknown()).optional() }).optional();
export const configResetInputSchema = z.object({ path: optionalString }).optional();
export const configPreviewNamingInputSchema = z
  .object({ config: z.record(z.string(), z.unknown()).optional() })
  .optional();
export const configProfileNameInputSchema = z.object({ name: optionalString });
export const configImportProfileInputSchema = z.object({
  filePath: optionalString,
  name: optionalString,
  overwrite: z.boolean().optional(),
});

export const scraperStartInputSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("selection"),
    refs: z.array(rootFileRefSchema).min(1),
    outputRootId: z.string().trim().min(1).optional(),
  }),
  z.object({
    mode: z.literal("single"),
    ref: rootFileRefSchema,
  }),
]);
export const scraperStartSinglePathInputSchema = z.object({ path: z.string().trim().min(1) });
export const scraperRetryInputSchema = z.object({ runId: z.string().min(1) });
export const scraperConfirmUncensoredInputSchema = z.object({
  items: z
    .array(
      z.object({
        fileId: z.string().min(1),
        nfoPath: z.string().min(1),
        videoPath: z.string().min(1),
        choice: z.enum(["umr", "leak", "uncensored"]),
      }),
    )
    .optional(),
});

export const crawlerTestInputSchema = z.object({
  site: z.nativeEnum(Website).optional(),
  number: optionalString,
});
export const crawlerProbeSiteInputSchema = z.object({ site: z.nativeEnum(Website).optional() });

export const translateTestLlmInputSchema = z.object({
  llmModelName: optionalString,
  llmApiKey: optionalString,
  llmBaseUrl: optionalString,
  llmPrompt: optionalString,
  llmTemperature: z.number().optional(),
  llmTimeout: z.number().optional(),
});

export const fileDirPathInputSchema = z.object({ dirPath: optionalString });
export const fileListMediaCandidatesInputSchema = z.object({
  dirPath: optionalString,
  excludeDirPaths: optionalPathList,
});
export const fileExistsInputSchema = z.object({ path: localFileTargetSchema });
export const fileBrowseInputSchema = z.object({
  type: z.enum(["file", "directory"]).optional(),
  filters: z.array(z.object({ name: z.string(), extensions: z.array(z.string()) })).optional(),
});
export const fileDeleteInputSchema = z.object({ filePaths: optionalPathList });
export const fileNfoReadInputSchema = z.object({
  nfoPath: localFileTargetSchema,
  videoPath: localFileTargetSchema.optional(),
});
export const fileNfoWriteInputSchema = z.object({
  nfoPath: localFileTargetSchema,
  videoPath: localFileTargetSchema.optional(),
  data: crawlerDataSchema.optional(),
});
export const filePosterCropSessionInputSchema = z.object({ videoPath: localFileTargetSchema });
export const filePosterCropSaveInputSchema = z.object({
  videoPath: localFileTargetSchema,
  crop: normalizedCropRegionSchema.optional(),
});

export const libraryDeleteInputSchema = z.object({
  id: optionalString,
  deleteMediaFiles: z.boolean().optional(),
});

export {
  configPathInputSchema,
  libraryAvailabilityInputSchema,
  libraryDetailInputSchema,
  libraryListInputSchema,
  mediaRootEnsurePathInputSchema,
};

export const toolCreateSymlinkInputSchema = z.object({
  sourceDir: optionalString,
  source_dir: optionalString,
  destDir: optionalString,
  dest_dir: optionalString,
  copyFiles: z.boolean().optional(),
  copy_files: z.boolean().optional(),
});
export const toolDirectoryInputSchema = z.object({ directory: optionalString });
export const toolAmazonPosterLookupInputSchema = z.object({ nfoPath: optionalString, title: optionalString });
export const toolAmazonPosterApplyInputSchema = z.object({
  items: z.array(z.object({ nfoPath: z.string(), amazonPosterUrl: z.string() })).optional(),
});
export const toolBatchTranslateApplyInputSchema = z.object({
  items: z
    .array(
      z.object({
        filePath: z.string(),
        nfoPath: z.string(),
        directory: z.string(),
        number: z.string(),
        title: z.string(),
        pendingFields: z.array(z.enum(["title", "plot"])),
      }),
    )
    .optional(),
  batchSize: z.number().optional(),
});
export const toolMediaServerModeInputSchema = z.object({ mode: z.enum(["all", "missing"]).optional() });

export const maintenanceStartPreviewInputSchema = z.object({
  refs: z.array(rootFileRefSchema).optional(),
  presetId: maintenancePresetIdSchema.optional(),
});
export const maintenanceApplyInputSchema = z.object({
  selections: z
    .array(
      z.object({
        previewId: z.string().min(1),
        fieldSelections: z.record(z.string(), z.enum(["old", "new"])).optional(),
      }),
    )
    .optional(),
  presetId: maintenancePresetIdSchema.optional(),
});
export const maintenanceUpdateDraftInputSchema = z.object({
  previewId: z.string().min(1),
  fieldSelections: z.record(z.string(), z.enum(["old", "new"])).optional(),
});
