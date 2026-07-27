export const shouldRunStartupUpdateCheck = (input: { enabled: boolean; isPackaged: boolean }): boolean =>
  input.enabled && input.isPackaged;
