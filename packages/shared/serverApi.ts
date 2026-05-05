import type { Configuration } from "./config";
import type {
  AuthLoginInput,
  AuthSessionDto,
  ConfigImportInput,
  ConfigPreviewInput,
  ConfigProfileExportResponse,
  ConfigProfileImportInput,
  ConfigProfileImportResponse,
  ConfigProfileListResponse,
  ConfigProfileNameInput,
  ConfigProfileNameResponse,
  ConfigUpdateInput,
  DiagnosticsSummaryResponse,
  FileActionInput,
  FileActionResponse,
  HealthResponse,
  LibraryDetailInput,
  LibraryDetailResponse,
  LibraryListInput,
  LibraryListResponse,
  LibraryRelinkInput,
  LogListInput,
  LogListResponse,
  MaintenanceApplyInput,
  MaintenanceApplyResponse,
  MaintenancePreviewResponse,
  MaintenanceScanSelectedFilesInput,
  MaintenanceScanSelectedFilesResponse,
  MaintenanceStartInput,
  MaintenanceTaskInput,
  MediaRootAvailabilityResponse,
  MediaRootCreateInput,
  MediaRootDto,
  MediaRootIdInput,
  MediaRootListResponse,
  MediaRootUpdateInput,
  NfoReadInput,
  NfoReadResponse,
  NfoWriteInput,
  NfoWriteResponse,
  OverviewSummaryResponse,
  PersistenceStatusDto,
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
  ScrapeRecoverableSessionResolveInput,
  ScrapeRecoverableSessionResolveResponse,
  ScrapeRecoverableSessionResponse,
  ScrapeResultDetailResponse,
  ScrapeResultIdInput,
  ScrapeResultListResponse,
  ScrapeStartInput,
  ScrapeStartSelectedFilesInput,
  ScrapeTaskControlInput,
  ServerPathSuggestInput,
  ServerPathSuggestResponse,
  SetupCompleteInput,
  SetupStatusDto,
  SystemAboutResponse,
  TaskEventListResponse,
  ToolCatalogResponse,
  ToolExecuteInput,
  ToolExecuteResponse,
} from "./serverDtos";
import type { NamingPreviewItem } from "./types";

export interface ServerApiContract {
  health: {
    read(): Promise<HealthResponse>;
  };
  system: {
    about(): Promise<SystemAboutResponse>;
  };
  auth: {
    setup(): Promise<AuthSessionDto>;
    status(): Promise<AuthSessionDto>;
    login(input: AuthLoginInput): Promise<AuthSessionDto>;
    logout(): Promise<AuthSessionDto>;
  };
  config: {
    defaults(): Promise<Configuration>;
    read(): Promise<Configuration>;
    previewNaming(input: ConfigPreviewInput): Promise<{ items: NamingPreviewItem[] }>;
    update(input: ConfigUpdateInput): Promise<Configuration>;
    save(input: ConfigUpdateInput): Promise<Configuration>;
    export(): Promise<string>;
    import(input: ConfigImportInput): Promise<Configuration>;
    reset(input?: { path?: string }): Promise<Configuration>;
    profiles: {
      list(): Promise<ConfigProfileListResponse>;
      create(input: ConfigProfileNameInput): Promise<ConfigProfileNameResponse>;
      switch(input: ConfigProfileNameInput): Promise<Configuration>;
      delete(input: ConfigProfileNameInput): Promise<ConfigProfileNameResponse>;
      export(input: ConfigProfileNameInput): Promise<ConfigProfileExportResponse>;
      import(input: ConfigProfileImportInput): Promise<ConfigProfileImportResponse>;
    };
  };
  persistence: {
    status(): Promise<PersistenceStatusDto>;
  };
  logs: {
    list(input?: LogListInput): Promise<LogListResponse>;
    clearRuntime(): Promise<{ ok: true; cleared: number }>;
  };
  maintenance: {
    scanSelectedFiles(input: MaintenanceScanSelectedFilesInput): Promise<MaintenanceScanSelectedFilesResponse>;
    start(input: MaintenanceStartInput): Promise<ScanTaskDto>;
    preview(input: MaintenanceTaskInput): Promise<MaintenancePreviewResponse>;
    apply(input: MaintenanceApplyInput): Promise<MaintenanceApplyResponse>;
    pause(input: MaintenanceTaskInput): Promise<ScanTaskDto>;
    resume(input: MaintenanceTaskInput): Promise<ScanTaskDto>;
    stop(input: MaintenanceTaskInput): Promise<ScanTaskDto>;
    recover(): Promise<ScanTaskListResponse>;
  };
  library: {
    list(input?: LibraryListInput): Promise<LibraryListResponse>;
    search(input?: LibraryListInput): Promise<LibraryListResponse>;
    detail(input: LibraryDetailInput): Promise<LibraryDetailResponse>;
    refresh(input: LibraryDetailInput): Promise<LibraryDetailResponse>;
    rescan(input: LibraryDetailInput): Promise<ScanTaskDto>;
    relink(input: LibraryRelinkInput): Promise<LibraryDetailResponse>;
  };
  overview: {
    summary(): Promise<OverviewSummaryResponse>;
  };
  diagnostics: {
    summary(): Promise<DiagnosticsSummaryResponse>;
  };
  tools: {
    catalog(): Promise<ToolCatalogResponse>;
    execute(input: ToolExecuteInput): Promise<ToolExecuteResponse>;
  };
  setup: {
    status(): Promise<SetupStatusDto>;
    complete(input: SetupCompleteInput): Promise<AuthSessionDto>;
  };
  mediaRoots: {
    list(): Promise<MediaRootListResponse>;
    create(input: MediaRootCreateInput): Promise<MediaRootDto>;
    update(input: MediaRootUpdateInput): Promise<MediaRootDto>;
    availability(input: MediaRootIdInput): Promise<MediaRootAvailabilityResponse>;
    enable(input: MediaRootIdInput): Promise<MediaRootDto>;
    disable(input: MediaRootIdInput): Promise<MediaRootDto>;
    delete(input: MediaRootIdInput): Promise<MediaRootDto>;
  };
  browser: {
    list(input: RootBrowserInput): Promise<RootBrowserResponse>;
  };
  serverPaths: {
    suggest(input: ServerPathSuggestInput): Promise<ServerPathSuggestResponse>;
  };
  scans: {
    start(input: ScanStartInput): Promise<ScanTaskDto>;
    candidates(input: ScanCandidatesInput): Promise<ScanCandidatesResponse>;
    list(): Promise<ScanTaskListResponse>;
    detail(input: ScanTaskIdInput): Promise<ScanTaskDetailResponse>;
    events(input: ScanTaskIdInput): Promise<TaskEventListResponse>;
    retry(input: ScanTaskIdInput): Promise<ScanTaskDto>;
  };
  scrape: {
    start(input: ScrapeStartInput): Promise<ScanTaskDto>;
    startSelectedFiles(input: ScrapeStartSelectedFilesInput): Promise<ScanTaskDto>;
    listResults(input?: ScrapeTaskControlInput): Promise<ScrapeResultListResponse>;
    result(input: ScrapeResultIdInput): Promise<ScrapeResultDetailResponse>;
    stop(input: ScrapeTaskControlInput): Promise<ScanTaskDto>;
    pause(input: ScrapeTaskControlInput): Promise<ScanTaskDto>;
    resume(input: ScrapeTaskControlInput): Promise<ScanTaskDto>;
    confirmUncensored(input: ScrapeConfirmUncensoredInput): Promise<ScanTaskDto>;
    retry(input: ScrapeTaskControlInput): Promise<ScanTaskDto>;
    getRecoverableSession(): Promise<ScrapeRecoverableSessionResponse>;
    resolveRecoverableSession(
      input?: ScrapeRecoverableSessionResolveInput,
    ): Promise<ScrapeRecoverableSessionResolveResponse>;
    nfoRead(input: NfoReadInput): Promise<NfoReadResponse>;
    nfoWrite(input: NfoWriteInput): Promise<NfoWriteResponse>;
    deleteFile(input: FileActionInput): Promise<FileActionResponse>;
  };
  tasks: {
    list(): Promise<ScanTaskListResponse>;
    detail(input: ScanTaskIdInput): Promise<ScanTaskDetailResponse>;
    events(input: ScanTaskIdInput): Promise<TaskEventListResponse>;
    retry(input: ScanTaskIdInput): Promise<ScanTaskDto>;
  };
}

export type ServerApiProcedure =
  | "health.read"
  | "system.about"
  | "auth.setup"
  | "auth.status"
  | "auth.login"
  | "auth.logout"
  | "config.defaults"
  | "config.read"
  | "config.previewNaming"
  | "config.update"
  | "config.save"
  | "config.export"
  | "config.import"
  | "config.reset"
  | "config.profiles.list"
  | "config.profiles.create"
  | "config.profiles.switch"
  | "config.profiles.delete"
  | "config.profiles.export"
  | "config.profiles.import"
  | "persistence.status"
  | "logs.list"
  | "logs.clearRuntime"
  | "maintenance.scanSelectedFiles"
  | "maintenance.start"
  | "maintenance.preview"
  | "maintenance.execute"
  | "maintenance.pause"
  | "maintenance.resume"
  | "maintenance.stop"
  | "maintenance.recover"
  | "tools.catalog"
  | "tools.execute"
  | "library.list"
  | "library.search"
  | "library.detail"
  | "library.refresh"
  | "library.rescan"
  | "library.relink"
  | "overview.summary"
  | "diagnostics.summary"
  | "setup.status"
  | "setup.complete"
  | "mediaRoots.list"
  | "mediaRoots.create"
  | "mediaRoots.update"
  | "mediaRoots.availability"
  | "mediaRoots.enable"
  | "mediaRoots.disable"
  | "mediaRoots.delete"
  | "browser.list"
  | "serverPaths.suggest"
  | "scans.start"
  | "scans.candidates"
  | "scans.list"
  | "scans.detail"
  | "scans.events"
  | "scans.retry"
  | "scrape.start"
  | "scrape.startSelectedFiles"
  | "scrape.listResults"
  | "scrape.result"
  | "scrape.stop"
  | "scrape.pause"
  | "scrape.resume"
  | "scrape.retry"
  | "scrape.confirmUncensored"
  | "scrape.getRecoverableSession"
  | "scrape.resolveRecoverableSession"
  | "scrape.nfoRead"
  | "scrape.nfoWrite"
  | "scrape.deleteFile"
  | "tasks.list"
  | "tasks.detail"
  | "tasks.events"
  | "tasks.retry";
