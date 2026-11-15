import type { BriefPlan, BriefPlanInput, MediaServerId } from "@mdcz/shared/briefCatalog";
import type { Configuration } from "@mdcz/shared/config";
import type { Website } from "@mdcz/shared/enums";
import type { LibraryEditJobDto, LibraryEditStartInput } from "@mdcz/shared/libraryEdit";
import type { MaintenanceActiveSessionSnapshot } from "@mdcz/shared/maintenanceTasks";
import type { MediaLibraryDto, MediaLibrarySettingsInput } from "@mdcz/shared/mediaLibrary";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type {
  PendingConfirmUncensoredInput,
  PendingItemDto,
  PendingRetryInput,
  PendingRetryManyInput,
} from "@mdcz/shared/pending";
import type {
  AppPreviewPosterBadgesInput,
  ConfigProfileListResponse,
  ConfigUpdateInput,
  LibraryEntryDto,
  LibraryIgnoreHealthInput,
  LibraryListInput,
  LibraryRestoreIgnoredInput,
  MaintenanceStartInput,
  NetworkCheckCookiesResponse,
  PersonSyncJobDto,
  PersonSyncStartInput,
  ScrapeRunSnapshotDto,
  ScrapeStartInput,
  SiteConnectivityProbeResponse,
  TranslateTestInputDto,
  TranslateTestResponse,
} from "@mdcz/shared/serverDtos";
import type { FieldAnchor } from "@mdcz/shared/settingsRegistry";
import type { BatchTranslateMode, MediaServerConnectionCheckResult } from "@mdcz/shared/toolTypes";
import type { NamingPreviewItem } from "@mdcz/shared/types";
import type { WorkbenchSetupPort } from "../adapters/useWorkbenchSetup";
import type { LibraryBrowseSearch } from "../library/libraryBrowse";
import type { PathAutocompleteResult } from "../path";

export interface SymlinkResult {
  total: number;
  linked: number;
  copied: number;
  skipped: number;
  failed: number;
  /** The links and copies a dry run would make. */
  planned: string[];
}

/** What the crawler tester answers: the merged data, or nothing when no site had the number. */
export interface CrawlerTestResult {
  data: { title?: string; actors?: string[]; genres?: string[]; release_date?: string; studio?: string } | null;
  elapsed: number;
}

/** A page Brief can open with its filters or form filled in. */
export type BriefDestination =
  | { page: "library"; search: LibraryBrowseSearch }
  | { page: "settings"; section?: FieldAnchor }
  | { page: "amazonPoster"; directory?: string }
  | { page: "batchTranslate"; directory?: string; mode?: BatchTranslateMode };

/**
 * Everything the page reads and calls. Confirm goes through the same procedures the owning pages call; Brief
 * has no way of its own to start a job.
 */
export interface BriefPort {
  plan(input: BriefPlanInput): Promise<BriefPlan>;
  /** Read fresh on every call: a settings card compares it with what it drew. */
  config(): Promise<Configuration>;
  libraries(): Promise<MediaLibraryDto[]>;
  setup: WorkbenchSetupPort;
  /** Directory suggestions for a path being typed, as the library editor offers them. */
  suggestDirectory?: (path: string) => Promise<PathAutocompleteResult>;
  /** Whether libraries can watch for new files here, as on the Libraries page. */
  showLibraryAutomation: boolean;
  pendingItems(): Promise<PendingItemDto[]>;
  /** Every movie the filter lists, all pages. */
  movies(filter: NonNullable<LibraryListInput>): Promise<LibraryEntryDto[]>;
  /** The first movies the filter lists, and how many it lists in all. */
  moviePage(
    filter: NonNullable<LibraryListInput>,
    limit: number,
  ): Promise<{ entries: LibraryEntryDto[]; total: number }>;
  posterSrc(entry: LibraryEntryDto): string;
  /** The media root and path of a file given by its absolute path. */
  fileRef(path: string): Promise<RootFileRef>;

  startScrape(input: ScrapeStartInput): Promise<string>;
  startMaintenance(input: MaintenanceStartInput): Promise<string>;
  retryPending(input: PendingRetryInput): Promise<string>;
  retryPendingMany(input: PendingRetryManyInput): Promise<string[]>;
  confirmUncensored(input: PendingConfirmUncensoredInput): Promise<void>;
  ignorePending(ids: string[]): Promise<void>;
  startEdit(input: LibraryEditStartInput): Promise<string>;
  updateConfig(patch: ConfigUpdateInput): Promise<Configuration>;
  createLibrary(settings: MediaLibrarySettingsInput): Promise<MediaLibraryDto>;
  updateLibrary(id: string, settings: MediaLibrarySettingsInput): Promise<MediaLibraryDto>;
  previewNaming(settings: MediaLibrarySettingsInput): Promise<NamingPreviewItem[]>;
  /** A sample poster with the badges drawn as these settings would draw them, as a data URL. */
  previewPosterBadges(input: AppPreviewPosterBadgesInput): Promise<string>;
  ignoreHealth(input: LibraryIgnoreHealthInput): Promise<void>;
  restoreIgnored(input: LibraryRestoreIgnoredInput): Promise<void>;
  profiles(): Promise<ConfigProfileListResponse>;
  switchProfile(name: string): Promise<void>;
  createProfile(name: string): Promise<void>;
  checkMediaServer(server: MediaServerId): Promise<MediaServerConnectionCheckResult>;
  startPersonSync(input: PersonSyncStartInput): Promise<string>;
  stopNameMatching(): Promise<MediaServerConnectionCheckResult>;
  symlink(input: { sourceDir: string; destDir: string; copyFiles: boolean; dryRun: boolean }): Promise<SymlinkResult>;
  probeSite(site: Website): Promise<SiteConnectivityProbeResponse>;
  checkCookies(): Promise<NetworkCheckCookiesResponse>;
  testTranslation(input: TranslateTestInputDto): Promise<TranslateTestResponse>;
  testNotifications(settings: Configuration["notifications"]): Promise<void>;
  crawlerTest(input: { number: string; site?: Website; manualUrl?: string }): Promise<CrawlerTestResult>;

  /** Null once the server no longer has the run. */
  scrapeSnapshot(taskId: string): Promise<ScrapeRunSnapshotDto | null>;
  maintenanceSession(): Promise<MaintenanceActiveSessionSnapshot | null>;
  editJob(): Promise<LibraryEditJobDto | null>;
  personSyncJob(): Promise<PersonSyncJobDto | null>;
  pauseScrape(taskId: string): Promise<void>;
  resumeScrape(taskId: string): Promise<void>;
  stopScrape(taskId: string): Promise<void>;
  /** Scrapes the failed files of a finished run again; resolves to the new run. */
  retryScrape(taskId: string): Promise<string>;
  pauseMaintenance(sessionId: string): Promise<void>;
  resumeMaintenance(sessionId: string): Promise<void>;
  stopMaintenance(sessionId: string): Promise<void>;

  /** The workbench's review screen, where maintenance changes are applied. */
  openMaintenanceReview(): void;
  open(destination: BriefDestination): void;
}
