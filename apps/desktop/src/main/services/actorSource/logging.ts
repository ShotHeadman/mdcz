export interface WarningLogger {
  warn(message: string): void;
}

export const logActorSourceWarnings = (
  logger: WarningLogger,
  personName: string,
  warnings: ReadonlyArray<string>,
): void => {
  for (const warning of warnings) {
    logger.warn(`Actor source warning for ${personName}: ${warning}`);
  }
};
