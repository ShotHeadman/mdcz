import { tipc } from "@egoist/tipc/main";
import { SerializableIpcError, toSerializableIpcError } from "./errors";

export const t = tipc.create();

export const asSerializableIpcError = (error: unknown): SerializableIpcError => {
  if (error instanceof SerializableIpcError) {
    return error;
  }
  return toSerializableIpcError(error);
};
