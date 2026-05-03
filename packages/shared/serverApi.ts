import type { Configuration } from "./config";
import type {
  AuthLoginInput,
  AuthSessionDto,
  ConfigImportInput,
  ConfigPreviewInput,
  ConfigUpdateInput,
  DiagnosticsSummaryResponse,
  HealthResponse,
  LibraryListInput,
  LibraryListResponse,
  LogListResponse,
  MediaRootAvailabilityResponse,
  MediaRootCreateInput,
  MediaRootDto,
  MediaRootIdInput,
  MediaRootListResponse,
  MediaRootUpdateInput,
  PersistenceStatusDto,
  RootBrowserInput,
  RootBrowserResponse,
  ScanStartInput,
  ScanTaskDetailResponse,
  ScanTaskDto,
  ScanTaskIdInput,
  ScanTaskListResponse,
  SetupCompleteInput,
  SetupStatusDto,
  TaskEventListResponse,
} from "./serverDtos";
import type { NamingPreviewItem } from "./types";

export interface ServerApiContract {
  health: {
    read(): Promise<HealthResponse>;
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
    export(): Promise<string>;
    import(input: ConfigImportInput): Promise<Configuration>;
    reset(input?: { path?: string }): Promise<Configuration>;
  };
  persistence: {
    status(): Promise<PersistenceStatusDto>;
  };
  logs: {
    list(): Promise<LogListResponse>;
  };
  library: {
    list(input?: LibraryListInput): Promise<LibraryListResponse>;
  };
  diagnostics: {
    summary(): Promise<DiagnosticsSummaryResponse>;
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
  scans: {
    start(input: ScanStartInput): Promise<ScanTaskDto>;
    list(): Promise<ScanTaskListResponse>;
    detail(input: ScanTaskIdInput): Promise<ScanTaskDetailResponse>;
    events(input: ScanTaskIdInput): Promise<TaskEventListResponse>;
    retry(input: ScanTaskIdInput): Promise<ScanTaskDto>;
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
  | "auth.setup"
  | "auth.status"
  | "auth.login"
  | "auth.logout"
  | "config.defaults"
  | "config.read"
  | "config.previewNaming"
  | "config.update"
  | "config.export"
  | "config.import"
  | "config.reset"
  | "persistence.status"
  | "logs.list"
  | "library.list"
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
  | "scans.start"
  | "scans.list"
  | "scans.detail"
  | "scans.events"
  | "scans.retry"
  | "tasks.list"
  | "tasks.detail"
  | "tasks.events"
  | "tasks.retry";
