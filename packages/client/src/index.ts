export type { ServerApiContract, ServerApiProcedure } from "@mdcz/shared/serverApi";
export type {
  AuthLoginInput,
  AuthSessionDto,
  HealthResponse,
  MediaRootCreateInput,
  MediaRootDto,
  MediaRootIdInput,
  MediaRootListResponse,
  MediaRootUpdateInput,
  RootBrowserEntryDto,
  RootBrowserInput,
  RootBrowserResponse,
  ScanStartInput,
  ScanStatus,
  ScanTaskDto,
  ScanTaskListResponse,
  SetupStatusDto,
  TaskEventDto,
  TaskEventListResponse,
  WebTaskUpdateDto,
} from "@mdcz/shared/serverDtos";

export interface RootRelativeFileRefDto {
  rootId: string;
  relativePath: string;
}
