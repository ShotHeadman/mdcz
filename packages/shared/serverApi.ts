import type { Configuration } from "./config";
import type { MaintenanceActiveSessionSnapshot } from "./maintenanceTasks";
import type {
  AppEnsureWatermarkDirectoryResponse,
  AuthLoginInput,
  AuthSessionDto,
  ConfigImportInput,
  ConfigPathInput,
  ConfigPreviewInput,
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
  MaintenanceScanSelectedFilesInput,
  MaintenanceScanSelectedFilesResponse,
  MaintenanceStartInput,
  MaintenanceTaskInput,
  MaintenanceUpdateDraftInput,
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
  ScrapeConfirmUncensoredInput,
  ScrapeHistoryResponse,
  ScrapeLiveRunsResponse,
  ScrapeMutationAckDto,
  ScrapePendingUncensoredConfirmationResponse,
  ScrapeResultDetailResponse,
  ScrapeResultIdInput,
  ScrapeStartInput,
  ScrapeStartSelectedFilesInput,
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
  TranslateTestLlmInputDto,
  TranslateTestLlmResponse,
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
    testLlm(input: TranslateTestLlmInputDto): Promise<TranslateTestLlmResponse>;
  };
  serverPaths: {
    suggest(input: ServerPathSuggestInput): Promise<ServerPathSuggestResponse>;
  };
  config: {
    defaults(): Promise<Configuration>;
    export(): Promise<string>;
    import(input: ConfigImportInput): Promise<Configuration>;
    read(input?: ConfigPathInput): Promise<Configuration>;
    previewNaming(input: ConfigPreviewInput): Promise<{ items: NamingPreviewItem[] }>;
    reset(input?: ConfigPathInput): Promise<Configuration>;
    update(input: ConfigUpdateInput): Promise<Configuration>;
    save(input: ConfigUpdateInput): Promise<Configuration>;
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
    scanSelectedFiles(input: MaintenanceScanSelectedFilesInput): Promise<MaintenanceScanSelectedFilesResponse>;
    apply(input: MaintenanceApplyInput): Promise<MaintenanceMutationAckDto>;
    pause(input: MaintenanceTaskInput): Promise<MaintenanceMutationAckDto>;
    getActiveSession(): Promise<MaintenanceActiveSessionSnapshot | null>;
    updateDraft(input: MaintenanceUpdateDraftInput): Promise<MaintenanceMutationAckDto>;
    discardSession(input?: MaintenanceDiscardSessionInput): Promise<MaintenanceMutationAckDto>;
    resume(input: MaintenanceTaskInput): Promise<MaintenanceMutationAckDto>;
    start(input: MaintenanceStartInput): Promise<MaintenanceMutationAckDto>;
    stop(input: MaintenanceTaskInput): Promise<MaintenanceMutationAckDto>;
  };
  library: {
    availability(input: LibraryAvailabilityInput): Promise<LibraryAvailabilityResponse>;
    list(input?: LibraryListInput): Promise<LibraryListResponse>;
    search(input?: LibraryListInput): Promise<LibraryListResponse>;
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
  mediaRoots: {
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
    candidates(input: ScanCandidatesInput): Promise<ScanCandidatesResponse>;
    detail(input: ScanTaskIdInput): Promise<ScanTaskDetailResponse>;
    events(input: ScanTaskIdInput): Promise<TaskEventListResponse>;
    list(): Promise<ScanTaskListResponse>;
    retry(input: ScanTaskIdInput): Promise<ScanTaskDto>;
    start(input: ScanStartInput): Promise<ScanTaskDto>;
  };
  scrape: {
    liveRuns(): Promise<ScrapeLiveRunsResponse>;
    pendingUncensoredConfirmation(): Promise<ScrapePendingUncensoredConfirmationResponse>;
    startSelectedFiles(input: ScrapeStartSelectedFilesInput): Promise<ScrapeMutationAckDto>;
    deleteFile(input: FileActionInput): Promise<FileActionResponse>;
    history(input?: ScrapeTaskControlInput): Promise<ScrapeHistoryResponse>;
    nfoRead(input: NfoReadInput): Promise<NfoReadResponse>;
    nfoWrite(input: NfoWriteInput): Promise<NfoWriteResponse>;
    posterCropSession(input: ScrapeResultIdInput): Promise<PosterCropSessionResponse>;
    posterCropSave(input: PosterCropSaveInput): Promise<PosterCropSessionResponse>;
    pause(input: ScrapeTaskControlInput): Promise<ScrapeMutationAckDto>;
    result(input: ScrapeResultIdInput): Promise<ScrapeResultDetailResponse>;
    resume(input: ScrapeTaskControlInput): Promise<ScrapeMutationAckDto>;
    retry(input: ScrapeTaskControlInput): Promise<ScrapeMutationAckDto>;
    confirmUncensored(input: ScrapeConfirmUncensoredInput): Promise<ScrapeMutationAckDto>;
    start(input: ScrapeStartInput): Promise<ScrapeMutationAckDto>;
    stop(input: ScrapeTaskControlInput): Promise<ScrapeMutationAckDto>;
  };
  setup: {
    complete(input: SetupCompleteInput): Promise<AuthSessionDto>;
    status(): Promise<SetupStatusDto>;
  };
}
