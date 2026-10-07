import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure } from "../ipcTypes";
import type {
  MediaLibraryDto,
  MediaLibraryIdInput,
  MediaLibraryListResponse,
  MediaLibrarySettingsInput,
  MediaLibraryUpdateInput,
} from "../mediaLibrary";
import type {
  PendingConfirmUncensoredInput,
  PendingDetailResponse,
  PendingIdInput,
  PendingListResponse,
  PendingRetryInput,
  PendingRetryResponse,
} from "../pending";
import type { NamingPreviewItem } from "../types";

export type LibrariesIpcContract = {
  [IpcChannel.Libraries_List]: IpcProcedure<void, MediaLibraryListResponse>;
  [IpcChannel.Libraries_Create]: IpcProcedure<MediaLibrarySettingsInput, MediaLibraryDto>;
  [IpcChannel.Libraries_Update]: IpcProcedure<MediaLibraryUpdateInput, MediaLibraryDto>;
  [IpcChannel.Libraries_Delete]: IpcProcedure<MediaLibraryIdInput, { success: true }>;
  [IpcChannel.Libraries_PreviewNaming]: IpcProcedure<MediaLibrarySettingsInput, { items: NamingPreviewItem[] }>;
  [IpcChannel.Pending_List]: IpcProcedure<void, PendingListResponse>;
  [IpcChannel.Pending_Detail]: IpcProcedure<PendingIdInput, PendingDetailResponse>;
  [IpcChannel.Pending_Retry]: IpcProcedure<PendingRetryInput, PendingRetryResponse>;
  [IpcChannel.Pending_ConfirmUncensored]: IpcProcedure<PendingConfirmUncensoredInput, { success: true }>;
  [IpcChannel.Pending_Ignore]: IpcProcedure<PendingIdInput, { success: true }>;
};
