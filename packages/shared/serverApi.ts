import type { Configuration } from "./config";
import type { MaintenanceActiveSessionSnapshot } from "./maintenanceTasks";
import type {
  MediaLibraryDto,
  MediaLibraryIdInput,
  MediaLibraryListResponse,
  MediaLibrarySettingsInput,
  MediaLibraryUpdateInput,
} from "./mediaLibrary";
import type {
  PendingConfirmUncensoredInput,
  PendingDetailResponse,
  PendingIdInput,
  PendingListResponse,
  PendingRetryInput,
  PendingRetryResponse,
} from "./pending";
import type {
  ApiKeyCreateInput,
  ApiKeyCreateResponse,
  ApiKeyListResponse,
  AppEnsureWatermarkDirectoryResponse,
  AuthLoginInput,
  AuthSessionDto,
  ConfigImportInput,
  ConfigPathInput,
  ConfigProfileExportResponse,
  ConfigProfileImportInput,
  ConfigProfileImportResponse,
  ConfigProfileListResponse,
  ConfigProfileNameInput,
  ConfigProfileNameResponse,
  ConfigUpdateInput,
  CrawlerListSitesResponse,
  CrawlerProbeSiteConnectivityInput,
  FileActionInput,
  FileActionResponse,
  HealthResponse,
  LibraryAvailabilityInput,
  LibraryAvailabilityResponse,
  LibraryDetailInput,
  LibraryDetailResponse,
  LibraryListInput,
  LibraryListResponse,
  LibraryRelinkInput,
  LogListInput,
  LogListResponse,
  MaintenanceApplyInput,
  MaintenanceDiscardSessionInput,
  MaintenanceMutationAckDto,
  MaintenanceSessionInput,
  MaintenanceStartInput,
  MaintenanceUpdateDraftInput,
  MediaRootEnsurePathInput,
  MediaRootEnsurePathResponse,
  MediaRootListResponse,
  NetworkCheckCookiesResponse,
  NfoReadInput,
  NfoReadResponse,
  NfoWriteInput,
  NfoWriteResponse,
  OverviewSummaryResponse,
  PersistenceStatusDto,
  PosterCropSaveInput,
  PosterCropSessionResponse,
  RootBrowserInput,
  RootBrowserResponse,
  ScanCandidatesInput,
  ScanCandidatesResponse,
  ScanStartInput,
  ScanTaskDetailResponse,
  ScanTaskDto,
  ScanTaskIdInput,
  ScanTaskListResponse,
  ScrapeHistoryResponse,
  ScrapeLiveRunsResponse,
  ScrapeMutationAckDto,
  ScrapeRerunDirectoryInput,
  ScrapeResultDetailResponse,
  ScrapeResultIdInput,
  ScrapeRunSnapshotDto,
  ScrapeStartInput,
  ScrapeTaskControlInput,
  ServerPathSuggestInput,
  ServerPathSuggestResponse,
  SetupCompleteInput,
  SetupStatusDto,
  SiteConnectivityProbeResponse,
  SystemAboutResponse,
  TaskEventListResponse,
  ToolCatalogResponse,
  ToolExecuteInput,
  ToolExecuteResponse,
  TranslateTestInputDto,
  TranslateTestResponse,
} from "./serverDtos";
import type { NamingPreviewItem } from "./types";

export interface ServerApiContract {
  auth: {
    setup(): Promise<AuthSessionDto>;
    login(input: AuthLoginInput): Promise<AuthSessionDto>;
    logout(): Promise<AuthSessionDto>;
    status(): Promise<AuthSessionDto>;
  };
  app: {
    ensureWatermarkDirectory(): Promise<AppEnsureWatermarkDirectoryResponse>;
  };
  browser: {
    list(input: RootBrowserInput): Promise<RootBrowserResponse>;
  };
  crawler: {
    listSites(): Promise<CrawlerListSitesResponse>;
    probeSiteConnectivity(input: CrawlerProbeSiteConnectivityInput): Promise<SiteConnectivityProbeResponse>;
  };
  network: {
    checkCookies(): Promise<NetworkCheckCookiesResponse>;
  };
  translate: {
    test(input: TranslateTestInputDto): Promise<TranslateTestResponse>;
  };
  serverPaths: {
    suggest(input: ServerPathSuggestInput): Promise<ServerPathSuggestResponse>;
  };
  config: {
    defaults(): Promise<Configuration>;
    export(): Promise<string>;
    import(input: ConfigImportInput): Promise<Configuration>;
    read(): Promise<Configuration>;
    reset(input?: Exclude<ConfigPathInput, undefined>): Promise<Configuration>;
    update(input: ConfigUpdateInput): Promise<Configuration>;
    profiles: {
      list(): Promise<ConfigProfileListResponse>;
      create(input: ConfigProfileNameInput): Promise<ConfigProfileNameResponse>;
      switch(input: ConfigProfileNameInput): Promise<Configuration>;
      delete(input: ConfigProfileNameInput): Promise<ConfigProfileNameResponse>;
      export(input: ConfigProfileNameInput): Promise<ConfigProfileExportResponse>;
      import(input: ConfigProfileImportInput): Promise<ConfigProfileImportResponse>;
    };
  };
  health: {
    read(): Promise<HealthResponse>;
  };
  system: {
    about(): Promise<SystemAboutResponse>;
  };
  logs: {
    list(input?: LogListInput): Promise<LogListResponse>;
    clearRuntime(): Promise<{ ok: true; cleared: number }>;
  };
  maintenance: {
    execute(input: MaintenanceApplyInput): Promise<MaintenanceMutationAckDto>;
    pause(input: MaintenanceSessionInput): Promise<MaintenanceMutationAckDto>;
    getActiveSession(): Promise<MaintenanceActiveSessionSnapshot | null>;
    updateDraft(input: MaintenanceUpdateDraftInput): Promise<MaintenanceMutationAckDto>;
    discardSession(input?: MaintenanceDiscardSessionInput): Promise<MaintenanceMutationAckDto>;
    resume(input: MaintenanceSessionInput): Promise<MaintenanceMutationAckDto>;
    start(input: MaintenanceStartInput): Promise<MaintenanceMutationAckDto>;
    stop(input: MaintenanceSessionInput): Promise<MaintenanceMutationAckDto>;
  };
  library: {
    removeFile(input: import("./serverDtos").LibraryFileRemoveInput): Promise<{ success: true }>;
    availability(input: LibraryAvailabilityInput): Promise<LibraryAvailabilityResponse>;
    list(input?: LibraryListInput): Promise<LibraryListResponse>;
    detail(input: LibraryDetailInput): Promise<LibraryDetailResponse>;
    refresh(input: LibraryDetailInput): Promise<LibraryDetailResponse>;
    rescan(input: LibraryDetailInput): Promise<ScanTaskDto>;
    relink(input: LibraryRelinkInput): Promise<LibraryDetailResponse>;
    delete(input: LibraryDetailInput): Promise<{ success: true }>;
  };
  overview: {
    summary(): Promise<OverviewSummaryResponse>;
    removeRecentAcquisition(input: LibraryDetailInput): Promise<{ success: true }>;
  };
  libraries: {
    list(): Promise<MediaLibraryListResponse>;
    create(input: MediaLibrarySettingsInput): Promise<MediaLibraryDto>;
    update(input: MediaLibraryUpdateInput): Promise<MediaLibraryDto>;
    delete(input: MediaLibraryIdInput): Promise<{ success: true }>;
    previewNaming(input: MediaLibrarySettingsInput): Promise<{ items: NamingPreviewItem[] }>;
  };
  pending: {
    list(): Promise<PendingListResponse>;
    detail(input: PendingIdInput): Promise<PendingDetailResponse>;
    retry(input: PendingRetryInput): Promise<PendingRetryResponse>;
    confirmUncensored(input: PendingConfirmUncensoredInput): Promise<{ success: true }>;
    ignore(input: PendingIdInput): Promise<{ success: true }>;
  };
  apiKeys: {
    list(): Promise<ApiKeyListResponse>;
    create(input: ApiKeyCreateInput): Promise<ApiKeyCreateResponse>;
    delete(input: { id: string }): Promise<{ success: true }>;
  };
  notifications: {
    test(): Promise<{ success: true }>;
  };
  mediaRoots: {
    ensurePath(input: MediaRootEnsurePathInput): Promise<MediaRootEnsurePathResponse>;
    list(): Promise<MediaRootListResponse>;
  };
  persistence: {
    status(): Promise<PersistenceStatusDto>;
  };
  tools: {
    catalog(): Promise<ToolCatalogResponse>;
    execute(input: ToolExecuteInput): Promise<ToolExecuteResponse>;
  };
  scans: {
    cancelCandidates(input: { scanId: string }): Promise<{ ok: true }>;
    candidates(input: ScanCandidatesInput): Promise<ScanCandidatesResponse>;
    detail(input: ScanTaskIdInput): Promise<ScanTaskDetailResponse>;
    events(input: ScanTaskIdInput): Promise<TaskEventListResponse>;
    list(): Promise<ScanTaskListResponse>;
    retry(input: ScanTaskIdInput): Promise<ScanTaskDto>;
    start(input: ScanStartInput): Promise<ScanTaskDto>;
  };
  scrape: {
    liveRuns(): Promise<ScrapeLiveRunsResponse>;
    snapshot(input: ScrapeTaskControlInput): Promise<ScrapeRunSnapshotDto>;
    removeRecord(input: FileActionInput): Promise<FileActionResponse>;
    history(input?: ScrapeTaskControlInput): Promise<ScrapeHistoryResponse>;
    nfoRead(input: NfoReadInput): Promise<NfoReadResponse>;
    nfoWrite(input: NfoWriteInput): Promise<NfoWriteResponse>;
    posterCropSession(input: ScrapeResultIdInput): Promise<PosterCropSessionResponse>;
    posterCropSave(input: PosterCropSaveInput): Promise<PosterCropSessionResponse>;
    pause(input: ScrapeTaskControlInput): Promise<ScrapeMutationAckDto>;
    result(input: ScrapeResultIdInput): Promise<ScrapeResultDetailResponse>;
    resume(input: ScrapeTaskControlInput): Promise<ScrapeMutationAckDto>;
    retry(input: ScrapeTaskControlInput): Promise<ScrapeMutationAckDto>;
    rerunDirectory(input: ScrapeRerunDirectoryInput): Promise<ScrapeMutationAckDto>;
    start(input: ScrapeStartInput): Promise<ScrapeMutationAckDto>;
    stop(input: ScrapeTaskControlInput): Promise<ScrapeMutationAckDto>;
  };
  setup: {
    complete(input: SetupCompleteInput): Promise<AuthSessionDto>;
    status(): Promise<SetupStatusDto>;
  };
}
