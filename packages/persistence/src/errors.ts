export const persistenceErrorCodes = {
  NotFound: "NOT_FOUND",
  ConstraintViolation: "CONSTRAINT_VIOLATION",
  MigrationFailed: "MIGRATION_FAILED",
} as const;

export type PersistenceErrorCode = (typeof persistenceErrorCodes)[keyof typeof persistenceErrorCodes];

export class PersistenceError extends Error {
  constructor(
    readonly code: PersistenceErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PersistenceError";
  }
}
