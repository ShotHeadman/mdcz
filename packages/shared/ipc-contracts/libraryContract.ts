import { IpcChannel } from "../IpcChannel";
import type { IpcProcedure } from "../ipcTypes";
import type {
  LibraryAvailabilityInput,
  LibraryAvailabilityResponse,
  LibraryListInput,
  LibraryListResponse,
} from "../serverDtos";

export interface LibraryDeleteInput {
  id: string;
}

export type LibraryIpcContract = {
  [IpcChannel.Library_RelinkFile]: IpcProcedure<import("../serverDtos").LibraryRelinkInput, { success: true }>;
  [IpcChannel.Library_RemoveFile]: IpcProcedure<import("../serverDtos").LibraryFileRemoveInput, { success: true }>;
  [IpcChannel.Library_Availability]: IpcProcedure<LibraryAvailabilityInput, LibraryAvailabilityResponse>;
  [IpcChannel.Library_List]: IpcProcedure<LibraryListInput, LibraryListResponse>;
  [IpcChannel.Library_Delete]: IpcProcedure<LibraryDeleteInput, { success: true }>;
};
