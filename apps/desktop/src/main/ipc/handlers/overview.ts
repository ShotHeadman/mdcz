import type { ServiceContainer } from "@main/container";
import { loggerService } from "@main/services/LoggerService";
import { toErrorMessage } from "@main/utils/common";
import { type MediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import { createRecentAcquisitionsFromEntries } from "@mdcz/runtime/library";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { OverviewRecentAcquisitionItem } from "@mdcz/shared/ipc-contracts/overviewContract";
import type { IpcRouterContract } from "@mdcz/shared/ipcContract";
import type { LibraryDetailInput } from "@mdcz/shared/serverDtos";
import { asSerializableIpcError, t } from "../shared";

const logger = loggerService.getLogger("IpcRouter:overview");

const isRemotePath = (value: string): boolean => /^https?:\/\//iu.test(value.trim());
const isAbsoluteLocalPath = (value: string): boolean =>
  /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("/") || value.startsWith("\\\\") || value.startsWith("//");

const resolveLibraryPath = (
  rootMap: ReadonlyMap<string, MediaRoot>,
  rootId: string | undefined,
  value: string | null | undefined,
): string | null => {
  const path = value?.trim();
  if (!path) {
    return null;
  }
  if (isRemotePath(path) || isAbsoluteLocalPath(path)) {
    return path;
  }

  const root = rootId ? rootMap.get(rootId) : undefined;
  return root ? resolveRootRelativePath(root, path) : path;
};

export const createOverviewHandlers = (
  context: ServiceContainer,
): Pick<
  IpcRouterContract,
  | typeof IpcChannel.Overview_GetRecentAcquisitions
  | typeof IpcChannel.Overview_RemoveRecentAcquisition
  | typeof IpcChannel.Overview_GetOutputSummary
> => {
  const { outputLibraryScanner } = context;

  return {
    [IpcChannel.Overview_GetRecentAcquisitions]: t.procedure.action(async () => {
      try {
        return { items: await readPersistedRecentAcquisitions(context) };
      } catch (error) {
        logger.error(`Overview recent acquisitions failed: ${toErrorMessage(error)}`);
        throw asSerializableIpcError(error);
      }
    }),
    [IpcChannel.Overview_RemoveRecentAcquisition]: t.procedure.input<LibraryDetailInput>().action(async ({ input }) => {
      try {
        return await context.desktopLibraryService.removeRecentAcquisition(input.id);
      } catch (error) {
        logger.error(`Overview remove recent acquisition failed: ${toErrorMessage(error)}`);
        throw asSerializableIpcError(error);
      }
    }),
    [IpcChannel.Overview_GetOutputSummary]: t.procedure.action(async () => {
      try {
        return await outputLibraryScanner.getSummary();
      } catch (error) {
        logger.error(`Overview output summary failed: ${toErrorMessage(error)}`);
        throw asSerializableIpcError(error);
      }
    }),
  };
};

const readPersistedRecentAcquisitions = async (context: ServiceContainer): Promise<OverviewRecentAcquisitionItem[]> => {
  const state = await context.persistenceService.getState();
  const [roots, entries] = await Promise.all([
    state.repositories.mediaRoots.list(),
    state.repositories.library.listEntries(),
  ]);
  const rootMap = new Map(roots.map((root) => [root.id, root]));
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const recent = createRecentAcquisitionsFromEntries(entries);

  return recent.map((record) => ({
    id: record.id ?? "",
    number: record.number,
    title: record.title,
    actors: record.actors,
    thumbnailPath: resolveLibraryPath(rootMap, entryById.get(record.id ?? "")?.rootId, record.thumbnailPath),
    lastKnownPath: resolveLibraryPath(rootMap, entryById.get(record.id ?? "")?.rootId, record.lastKnownPath),
    completedAt: record.completedAt,
  }));
};
