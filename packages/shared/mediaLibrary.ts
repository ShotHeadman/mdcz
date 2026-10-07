import { z } from "zod";
import { localPathStyle } from "./localPath";

/**
 * How a scraped video reaches the output directory.
 * - `move`, `hardlink`, `copy`: the output holds a real video file named by the templates.
 * - `symlink`, `strm`: the video stays put; the output holds a link to it next to the metadata.
 * - `metadataOnly`: the video stays put; only metadata is written under the output directory.
 * - `inPlace`: the video stays put and keeps its name; metadata is written next to it.
 */
export const PLACEMENT_MODES = ["move", "hardlink", "copy", "symlink", "strm", "metadataOnly", "inPlace"] as const;
export type PlacementMode = (typeof PLACEMENT_MODES)[number];

/** Placements that leave the source video where it is. */
export const SOURCE_KEEPING_PLACEMENTS: ReadonlySet<PlacementMode> = new Set([
  "hardlink",
  "copy",
  "symlink",
  "strm",
  "metadataOnly",
  "inPlace",
]);

/** Placements whose output directory must not overlap the source directory: the output would be scanned as media. */
export const SEPARATE_OUTPUT_PLACEMENTS: ReadonlySet<PlacementMode> = new Set(["symlink", "strm", "metadataOnly"]);

export const AUTOMATION_LEVELS = ["off", "register", "scrape"] as const;
export type AutomationLevel = (typeof AUTOMATION_LEVELS)[number];

export const DISCOVERY_MODES = ["events", "clouddrive"] as const;
export type DiscoveryMode = (typeof DISCOVERY_MODES)[number];

export type MediaLibraryIssueCode =
  | "libraryPathNotAbsolute"
  | "libraryOutputRequired"
  | "libraryOutputOverlapsSource"
  | "libraryCloudPathInvalid"
  | "optionalSegmentPathSeparator";

const OPTIONAL_GROUP_WITH_PATH_SEPARATOR = /\[[^[\]]*[\\/][^[\]]*\]/u;

const absolutePathSchema = z
  .string()
  .trim()
  .refine((value) => !value || localPathStyle(value), "libraryPathNotAbsolute" satisfies MediaLibraryIssueCode);

const comparablePath = (value: string): string => {
  const normalized = value.trim().replaceAll("\\", "/").replace(/\/+$/u, "");
  return localPathStyle(value) === "windows" ? normalized.toLowerCase() : normalized;
};

const pathContains = (parent: string, child: string): boolean => {
  const left = comparablePath(parent);
  const right = comparablePath(child);
  return right === left || right.startsWith(`${left}/`);
};

/** CloudDrive2 virtual paths are POSIX strings on every platform, never host paths. */
export const normalizeCloudPath = (value: string): string => {
  const raw = value.trim().replaceAll("\\", "/").normalize("NFC");
  if (!raw.startsWith("/")) throw new Error("CloudDrive path must start with /");
  const segments = raw.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("CloudDrive path must not contain . or .. segments");
  }
  return `/${segments.join("/")}`;
};

export const cloudPathCovers = (root: string, filePath: string): boolean =>
  filePath === root || filePath.startsWith(root === "/" ? "/" : `${root}/`);

export const mediaLibrarySettingsSchema = z
  .object({
    name: z.string().trim().min(1),
    sourcePath: absolutePathSchema.refine(Boolean, "libraryPathNotAbsolute" satisfies MediaLibraryIssueCode),
    outputPath: absolutePathSchema.default(""),
    folderTemplate: z.string().default("{actor}/{number}"),
    fileTemplate: z.string().default("{number}"),
    placement: z.enum(PLACEMENT_MODES).default("move"),
    automation: z.enum(AUTOMATION_LEVELS).default("off"),
    discovery: z.enum(DISCOVERY_MODES).default("events"),
    cloudPath: z.string().trim().default(""),
    /** Full rescans catch what events miss: network mounts without change events, or a missed webhook. */
    scanIntervalMinutes: z.number().int().min(1).max(1440).default(15),
  })
  .superRefine((value, ctx) => {
    if (value.placement !== "inPlace" && !value.outputPath) {
      ctx.addIssue({
        code: "custom",
        path: ["outputPath"],
        message: "libraryOutputRequired" satisfies MediaLibraryIssueCode,
      });
    }
    if (
      SEPARATE_OUTPUT_PLACEMENTS.has(value.placement) &&
      value.outputPath &&
      (pathContains(value.sourcePath, value.outputPath) || pathContains(value.outputPath, value.sourcePath))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["outputPath"],
        message: "libraryOutputOverlapsSource" satisfies MediaLibraryIssueCode,
      });
    }
    for (const field of ["folderTemplate", "fileTemplate"] as const) {
      if (OPTIONAL_GROUP_WITH_PATH_SEPARATOR.test(value[field]))
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "optionalSegmentPathSeparator" satisfies MediaLibraryIssueCode,
        });
    }
    if (value.discovery === "clouddrive") {
      try {
        if (normalizeCloudPath(value.cloudPath) === "/") throw new Error("root");
      } catch {
        ctx.addIssue({
          code: "custom",
          path: ["cloudPath"],
          message: "libraryCloudPathInvalid" satisfies MediaLibraryIssueCode,
        });
      }
    }
  });

export type MediaLibrarySettings = z.infer<typeof mediaLibrarySettingsSchema>;
/** What callers send: fields with defaults may be omitted. */
export type MediaLibrarySettingsInput = z.input<typeof mediaLibrarySettingsSchema>;

export const mediaLibraryDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  sourcePath: z.string(),
  outputPath: z.string(),
  folderTemplate: z.string(),
  fileTemplate: z.string(),
  placement: z.enum(PLACEMENT_MODES),
  automation: z.enum(AUTOMATION_LEVELS),
  discovery: z.enum(DISCOVERY_MODES),
  cloudPath: z.string(),
  scanIntervalMinutes: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type MediaLibraryDto = z.infer<typeof mediaLibraryDtoSchema>;

export const mediaLibraryIdInputSchema = z.object({ id: z.string().trim().min(1) });
export type MediaLibraryIdInput = z.infer<typeof mediaLibraryIdInputSchema>;

export const mediaLibraryUpdateInputSchema = z.object({
  id: z.string().trim().min(1),
  settings: mediaLibrarySettingsSchema,
});
export type MediaLibraryUpdateInput = z.input<typeof mediaLibraryUpdateInputSchema>;

export const mediaLibraryListResponseSchema = z.object({ libraries: z.array(mediaLibraryDtoSchema) });
export type MediaLibraryListResponse = z.infer<typeof mediaLibraryListResponseSchema>;

/** The publication side of a library: where and how one scrape run writes its output. */
export type PublicationTarget = Pick<
  MediaLibrarySettings,
  "placement" | "outputPath" | "folderTemplate" | "fileTemplate"
>;

/** A folder template without a per-movie field puts several movies in one directory, which constrains asset names. */
export const isSharedDirectoryTarget = (target: Pick<PublicationTarget, "placement" | "folderTemplate">): boolean => {
  if (target.placement === "inPlace") return false;
  for (const match of target.folderTemplate.matchAll(/\{([^{}]+)\}/gu)) {
    const key = match[1]?.trim().toLowerCase();
    if (key && ["number", "rawnumber", "title", "originaltitle", "filename"].includes(key)) return false;
  }
  return true;
};
