import { z } from "zod";
import { ASSET_NAMING_MODES, NFO_NAMING_MODES } from "./assetNaming";
import type { BriefSettingsChange } from "./briefSettings";
import { llmSchema } from "./config";
import { Website } from "./enums";
import { LIBRARY_EDIT_FIELDS } from "./libraryEdit";
import { AUTOMATION_LEVELS, DISCOVERY_MODES, PLACEMENT_MODES } from "./mediaLibrary";
import { PENDING_KINDS, type PendingItemDto } from "./pending";
import { LIBRARY_HEALTH_ISSUES, maintenancePresetIdSchema } from "./serverDtos";
import { SECTION_ORDER } from "./settingsRegistry";

export const BRIEF_WORKFLOWS = [
  "scrape",
  "maintenance",
  "pending",
  "edit",
  "person-sync",
  "settings",
  "library",
  "symlink",
  "check",
  "profile",
  "open",
] as const;
export type BriefWorkflow = (typeof BRIEF_WORKFLOWS)[number];
export const briefWorkflowSchema = z.enum(BRIEF_WORKFLOWS);

/** The slash command that opens a workflow's card; the same as its id except where the id is long. */
export const briefCommand = (workflow: BriefWorkflow): string => (workflow === "person-sync" ? "sync" : workflow);

export const MEDIA_SERVERS = ["jellyfin", "emby"] as const;
export type MediaServerId = (typeof MEDIA_SERVERS)[number];

export const CHECK_TARGETS = ["sites", "cookies", "translation", "notifications", "mediaServer", "crawler"] as const;
export const OPEN_TARGETS = ["library", "settings", "amazonPoster", "batchTranslate"] as const;
export const BATCH_TRANSLATE_MODES = ["untranslated", "all", "restore"] as const;

const text = z.string().trim().min(1);
const server = z.enum(MEDIA_SERVERS).describe("A media server; only the configured ones can be used.");

/**
 * One entry per kind of job Brief prepares. `when` and the parameter descriptions are written for the model;
 * titles shown to people live in the locale dictionaries. Every parameter is optional: one the model leaves out is an
 * empty control on the card. Settings take their changes from a second call that carries the field list.
 */
export const BRIEF_CATALOG = {
  scrape: {
    when: "Scrape metadata for videos into a library: the new videos in a directory, or one video file, optionally from a given detail-page URL or with a corrected movie number.",
    params: z
      .object({
        libraryId: text.describe("Id of the library to publish into."),
        directory: text.describe("Absolute path of the directory whose videos to scrape."),
        recursive: z.boolean().describe("Whether subdirectories are included."),
        file: text.describe("Absolute path of a single video file to scrape on its own."),
        url: text.describe("Detail-page URL to scrape the single file from."),
        number: text.describe("Movie number to use for the single file instead of the one in its name."),
      })
      .partial(),
  },
  maintenance: {
    when: "Maintain movies already in a library: import local NFOs, refresh metadata, re-merge, organize or rebuild the files in a directory; or repair the movies that have one library health issue.",
    params: z
      .object({
        presetId: maintenancePresetIdSchema.describe(
          "import_local reads existing NFOs; refresh_metadata scrapes again; remerge merges saved site results again; local_organize moves files into the library's layout; rebuild_all does all of it.",
        ),
        libraryId: text.describe("Id of the library the movies belong to."),
        directory: text.describe("Absolute path of the directory to maintain."),
        recursive: z.boolean().describe("Whether subdirectories are included."),
        issue: z
          .enum(LIBRARY_HEALTH_ISSUES)
          .describe("A library health issue whose movies to repair, in place of a directory."),
      })
      .partial(),
  },
  pending: {
    when: "Act on files waiting on the pending list: scrape them again, repair one file with a number or detail-page URL, confirm the type of uncensored files, or ignore files.",
    params: z
      .object({
        action: z.enum(["retry", "repair", "confirm", "ignore"]),
        kinds: z.array(z.enum(PENDING_KINDS)).describe("Only files waiting for these reasons."),
        libraryId: text.describe("Only files found for the library with this id."),
        name: text.describe("Only files whose name contains this text."),
        targetLibraryId: text.describe("Id of the library to scrape into, instead of each file's own."),
        number: text.describe("Movie number for a repair."),
        url: text.describe("Detail-page URL for a repair."),
        choice: z.enum(["uncensored", "umr", "leak"]).describe("The type to confirm uncensored files as."),
      })
      .partial(),
  },
  edit: {
    when: "Change one field across the library movies a filter lists: set or clear the studio, publisher, director or series; add, remove or rename a genre or an actor.",
    params: z
      .object({
        libraryId: text.describe("Only movies in the library with this id."),
        actor: text.describe("Only movies with this actor."),
        studio: text.describe("Only movies from this studio."),
        tag: text.describe("Only movies with this genre."),
        query: text.describe("Only movies matching this search text."),
        field: z.enum(LIBRARY_EDIT_FIELDS),
        operation: z
          .enum(["set", "clear", "add", "remove", "rename"])
          .describe(
            "set and clear apply to studio, publisher, director and series; add, remove and rename to genres and actors.",
          ),
        value: text.describe("The new value: what to set, add, or rename to."),
        from: text.describe("The existing genre or actor to remove or rename."),
      })
      .partial(),
  },
  "person-sync": {
    when: "Sync actor info or actor photos to a media server (Jellyfin or Emby), or stop Jellyfin from filling new actors by searching their names online.",
    params: z
      .object({
        action: z.enum(["sync", "stopNameMatching"]),
        server,
        kind: z.enum(["info", "photo"]).describe("info writes biographies; photo uploads portraits."),
        mode: z.enum(["missing", "all"]).describe("missing touches only actors without it; all rewrites every actor."),
      })
      .partial(),
  },
  settings: {
    when: "Change the app's settings: turn an option on or off, set a value, put a field back to its default, or add, remove or reorder entries of a list (sites, proxy, timeouts, translation, naming rules, downloads, media server connections, notifications, keys and cookies).",
    params: z.object({}),
  },
  library: {
    when: "Create a library, change one library's own settings (name, source and output directories, folder and file name templates, placement, automation), or ignore or restore a health issue across a library's movies.",
    params: z
      .object({
        action: z.enum(["create", "update", "ignoreHealth", "restoreIgnored"]),
        libraryId: text.describe("Id of the library to change, or whose movies to ignore or restore."),
        name: text,
        sourcePath: text.describe("Absolute path the library scans for new videos."),
        outputPath: text.describe("Absolute path scraped movies are published to."),
        folderTemplate: text.describe("Folder name template, such as {actor}/{number}."),
        fileTemplate: text.describe("File name template, such as {number}."),
        placement: z
          .enum(PLACEMENT_MODES)
          .describe("How a scraped video reaches the output: moved, linked, copied, or left in place."),
        assetNaming: z.enum(ASSET_NAMING_MODES),
        nfoNaming: z.enum(NFO_NAMING_MODES),
        automation: z.enum(AUTOMATION_LEVELS).describe("off; register new files; or scrape them on arrival."),
        discovery: z.enum(DISCOVERY_MODES),
        cloudPath: text,
        scanIntervalMinutes: z.number().int().min(1).max(1440),
        issue: z.enum(LIBRARY_HEALTH_ISSUES).describe("The health issue to ignore."),
      })
      .partial(),
  },
  symlink: {
    when: "Mirror a directory of videos into another directory as symbolic links (the symlink manager), optionally copying NFOs, images and subtitles beside them.",
    params: z
      .object({
        sourceDir: text.describe("Absolute path of the directory to mirror."),
        destDir: text.describe("Absolute path the links are created in."),
        copyFiles: z.boolean().describe("Whether NFOs, images and subtitles are copied too."),
      })
      .partial(),
  },
  check: {
    when: "Run a read-only check: whether the scrape sites are reachable, whether site cookies work, whether translation works, a test notification, a media server connection, or a crawler test that scrapes one movie number without saving anything.",
    params: z
      .object({
        target: z.enum(CHECK_TARGETS),
        server,
        number: text.describe("Movie number for a crawler test."),
        site: z.enum(Website).describe("The one site a crawler test asks, in place of every enabled site."),
        url: text.describe("Detail-page URL a crawler test reads."),
      })
      .partial(),
  },
  profile: {
    when: "Switch to another configuration profile, or create a new one.",
    params: z
      .object({
        action: z.enum(["switch", "create"]),
        name: text.describe("The profile name."),
      })
      .partial(),
  },
  open: {
    when: "Show something on its own page with the filters or form filled in: library movies filtered by library, actor, studio, genre or health issue; a Settings section; the Amazon poster tool; or batch NFO translation.",
    params: z
      .object({
        target: z.enum(OPEN_TARGETS),
        libraryId: text.describe("Only movies in the library with this id."),
        actor: text.describe("Only movies with this actor."),
        studio: text.describe("Only movies from this studio."),
        tag: text.describe("Only movies with this genre."),
        health: z.enum(LIBRARY_HEALTH_ISSUES).describe("Only movies with this health issue."),
        section: z.enum(SECTION_ORDER).describe("The Settings section to open."),
        directory: text.describe("Absolute path of the directory the tool starts from."),
        mode: z
          .enum(BATCH_TRANSLATE_MODES)
          .describe("Batch translation: the untranslated NFOs, all of them, or restoring the originals."),
      })
      .partial(),
  },
} as const;

type CatalogParams = { [W in BriefWorkflow]: z.infer<(typeof BRIEF_CATALOG)[W]["params"]> };
export type BriefParams = Omit<CatalogParams, "settings"> & { settings: { changes?: BriefSettingsChange[] } };

/** Why code dropped a value the model returned; the card shows it under the empty control. */
export const BRIEF_DROP_REASONS = [
  "unknownLibrary",
  "relativePath",
  "invalid",
  "noMatch",
  "notOnMovies",
  "notConfigured",
  "exists",
  "unknownField",
  "notInList",
  "unchanged",
] as const;
export type BriefDropReason = (typeof BRIEF_DROP_REASONS)[number];

export interface BriefDrop {
  /** The parameter, or for settings the field key. */
  param: string;
  value: string;
  reason: BriefDropReason;
}

interface BriefPlanBase {
  /** Parameters, or for settings field keys, whose value the model worked out rather than found in the request. */
  workedOut: string[];
  dropped: BriefDrop[];
}

export type BriefPlan =
  | ({ workflow: null } & BriefPlanBase)
  | {
      [W in BriefWorkflow]: {
        workflow: W;
        params: BriefParams[W];
        /**
         * Set when a follow-up changed the open draft: the parameters (for settings, the fields) it changed. `params`
         * is then the whole draft. Absent for a plan that starts a cell of its own.
         */
        changed?: string[];
      } & BriefPlanBase;
    }[BriefWorkflow];

export type BriefWorkflowPlan = Exclude<BriefPlan, { workflow: null }>;

export const briefDraftSchema = z.object({
  workflow: briefWorkflowSchema,
  params: z.record(z.string(), z.unknown()),
});
export type BriefDraft = {
  [W in BriefWorkflow]: { workflow: W; params: BriefParams[W] };
}[BriefWorkflow];

export const briefPlanInputSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  /** Fixed by a slash command or a pick from the workflow list; the model then fills that workflow only. */
  workflow: briefWorkflowSchema.optional(),
  /** The open draft a follow-up talks to, with the card's current values and no secrets. */
  draft: briefDraftSchema.optional(),
  /**
   * Labels and descriptions of the settings fields in the user's language, which is also the prompt's. They live in
   * the UI dictionaries; the server uses them as prompt text only and checks the keys against its own registry.
   */
  settingsFields: z
    .record(z.string(), z.object({ label: z.string().max(300), description: z.string().max(3000).optional() }))
    .optional(),
});
export type BriefPlanInput = z.infer<typeof briefPlanInputSchema>;

/** The AI model section as edited, so the switch can be turned on before the connection is saved. */
export const briefCheckInputSchema = llmSchema;

export const briefCheckResponseSchema = z.object({
  status: z.enum(["ok", "missing_model", "missing_credentials", "failed", "wrong_plan"]),
  error: z.string().optional(),
});
export type BriefCheckResponse = z.infer<typeof briefCheckResponseSchema>;

export interface PendingFilter {
  kinds?: readonly PendingItemDto["kind"][];
  libraryId?: string;
  name?: string;
}

/** The model names files only through this filter; the card and the planner run it over the pending list. */
export const matchPendingItems = (items: readonly PendingItemDto[], filter: PendingFilter): PendingItemDto[] => {
  const name = filter.name?.trim().toLowerCase();
  return items.filter(
    (item) =>
      (!filter.kinds?.length || filter.kinds.includes(item.kind)) &&
      (!filter.libraryId || item.libraryId === filter.libraryId) &&
      (!name || item.fileName.toLowerCase().includes(name)),
  );
};
