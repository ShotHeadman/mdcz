export const storageErrorCodes = {
  OutsideRoot: "OUTSIDE_ROOT",
  MissingPath: "MISSING_PATH",
  PermissionDenied: "PERMISSION_DENIED",
  UnsupportedOperation: "UNSUPPORTED_OPERATION",
} as const;

export type StorageErrorCode = (typeof storageErrorCodes)[keyof typeof storageErrorCodes];

export class StorageError extends Error {
  constructor(
    readonly code: StorageErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export const toStorageError = (error: unknown, pathLabel: string): StorageError => {
  if (error instanceof StorageError) {
    return error;
  }

  const nodeError = error as NodeJS.ErrnoException;
  if (nodeError?.code === "ENOENT") {
    return new StorageError(storageErrorCodes.MissingPath, `Path does not exist: ${pathLabel}`, error);
  }
  if (nodeError?.code === "EACCES" || nodeError?.code === "EPERM") {
    return new StorageError(storageErrorCodes.PermissionDenied, `Permission denied: ${pathLabel}`, error);
  }

  return new StorageError(storageErrorCodes.UnsupportedOperation, `Storage operation failed: ${pathLabel}`, error);
};
