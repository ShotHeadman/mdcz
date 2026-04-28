import type {
  AuthLoginInput,
  AuthSessionDto,
  HealthResponse,
  MediaRootCreateInput,
  MediaRootDto,
  MediaRootIdInput,
  MediaRootListResponse,
  MediaRootUpdateInput,
  PersistenceStatusDto,
  RootBrowserInput,
  RootBrowserResponse,
  ScanStartInput,
  ScanTaskDto,
  ScanTaskListResponse,
  SetupStatusDto,
  TaskEventListResponse,
} from "./serverDtos";

export interface ServerApiContract {
  health: {
    read(): Promise<HealthResponse>;
  };
  auth: {
    status(): Promise<AuthSessionDto>;
    login(input: AuthLoginInput): Promise<AuthSessionDto>;
    logout(): Promise<AuthSessionDto>;
  };
  config: {
    read(): Promise<unknown>;
    export(): Promise<unknown>;
  };
  persistence: {
    status(): Promise<PersistenceStatusDto>;
  };
  setup: {
    status(): Promise<SetupStatusDto>;
  };
  mediaRoots: {
    list(): Promise<MediaRootListResponse>;
    create(input: MediaRootCreateInput): Promise<MediaRootDto>;
    update(input: MediaRootUpdateInput): Promise<MediaRootDto>;
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
    events(input: { taskId: string }): Promise<TaskEventListResponse>;
  };
}

export type ServerApiProcedure =
  | "health.read"
  | "auth.status"
  | "auth.login"
  | "auth.logout"
  | "config.read"
  | "config.export"
  | "persistence.status"
  | "setup.status"
  | "mediaRoots.list"
  | "mediaRoots.create"
  | "mediaRoots.update"
  | "mediaRoots.enable"
  | "mediaRoots.disable"
  | "mediaRoots.delete"
  | "browser.list"
  | "scans.start"
  | "scans.list"
  | "scans.events";
