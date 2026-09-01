import type { ServiceContainer } from "@main/container";
import { createIpcRouter } from "@main/ipc/router";
import type { IpcProcedure } from "@mdcz/shared/ipcTypes";
import { type IpcMainInvokeEvent, ipcMain } from "electron";

type InvokableIpcRoute = IpcProcedure<unknown>;

export const registerIpcHandlers = (context: ServiceContainer): void => {
  const router = createIpcRouter(context);
  for (const [channel, route] of Object.entries(router) as [string, InvokableIpcRoute][]) {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, payload: unknown) =>
      route.action({
        context: {
          sender: event.sender,
          senderFrame: event.senderFrame ? { url: event.senderFrame.url } : null,
        },
        input: payload,
      }),
    );
  }
};
