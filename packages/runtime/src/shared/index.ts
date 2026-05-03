export interface RuntimeLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface RuntimeEvents<TPayload = unknown> {
  publish(payload: TPayload): void;
}

export const noopRuntimeLogger: RuntimeLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export const runtimeLoggerService = {
  getLogger: (_name: string): RuntimeLogger => noopRuntimeLogger,
};

export * from "./CachedAsyncResolver";
export * from "./language";
export * from "./utils";
