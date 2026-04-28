import { registerIpcMain } from "@egoist/tipc/main";
import type { ServiceContainer } from "@main/container";
import { createIpcRouter } from "@main/ipc/router";

export const registerIpcHandlers = (context: ServiceContainer): void => {
  registerIpcMain(createIpcRouter(context));
};
