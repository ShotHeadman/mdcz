import { lstat, rename, rm } from "node:fs/promises";
import path from "node:path";
import { type RuntimeLogger, runtimeLoggerService, toErrorMessage } from "../shared";
import { assertMoveTargetAbsent } from "./MoveOutput";
import { type PublicationJournalStore, publicationJournal } from "./publicationJournal";

const exists = async (filePath: string): Promise<boolean> =>
  await lstat(filePath).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );

/** Attaches the journal for this run and undoes what an interrupted earlier run left behind. */
export const recoverInterruptedPublications = async (
  store: PublicationJournalStore,
  logger: Pick<RuntimeLogger, "warn"> = runtimeLoggerService.getLogger("PublicationRecovery"),
): Promise<void> => {
  publicationJournal.attach(store);
  const reachableVolumes = new Map<string, boolean>();
  // Removals go first: an interrupted direct write leaves a truncated file where its original is restored to.
  for (const entry of store
    .list()
    .toSorted((left, right) => Number(left.restoreTo !== null) - Number(right.restoreTo !== null))) {
    try {
      // An offline network share can stall every lookup until it times out, so each volume is probed once per start.
      const volume = path.parse(entry.path).root;
      let volumeReachable = reachableVolumes.get(volume);
      if (volumeReachable === undefined) {
        volumeReachable = await exists(volume).catch(() => false);
        reachableVolumes.set(volume, volumeReachable);
      }
      // An unreachable folder, such as a network or cloud mount that is offline, keeps its record for a later start.
      if (!volumeReachable || !(await exists(path.dirname(entry.path)))) continue;
      if (entry.restoreTo === null) {
        await rm(entry.path, { recursive: true, force: true });
      } else if (await exists(entry.path)) {
        // A crash between parking and relocating a source hides the video behind a dot-prefixed name.
        await assertMoveTargetAbsent(entry.restoreTo);
        await rename(entry.path, entry.restoreTo);
      }
      store.forget(entry.path);
    } catch (error) {
      logger.warn(`Failed to recover publication temporary path ${entry.path}: ${toErrorMessage(error)}`);
    }
  }
};
