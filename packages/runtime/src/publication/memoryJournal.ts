import { manifestRefs } from "./manifest";
import type { PublicationJournalPort, PublicationJournalRecord } from "./types";

export const createMemoryPublicationJournal = (): PublicationJournalPort => {
  const entries = new Map<string, PublicationJournalRecord>();
  return {
    begin(entry) {
      if (entries.has(entry.operationId)) throw new Error(`Publication journal already exists: ${entry.operationId}`);
      entries.set(entry.operationId, { ...entry, state: "pending" });
    },
    commit(operationId, write) {
      const entry = entries.get(operationId);
      if (entry?.state !== "pending") throw new Error(`Publication journal operation is not pending: ${operationId}`);
      const result = write();
      entry.state = "committed";
      return result;
    },
    finish(operationId) {
      entries.delete(operationId);
    },
    listUnfinished() {
      return [...entries.values()];
    },
    conflicts(refs) {
      const requested = new Set(refs.map((ref) => `${ref.rootId}\0${ref.relativePath}`));
      return (
        [...entries.values()].find((entry) =>
          manifestRefs(entry.manifest).some((ref) => requested.has(`${ref.rootId}\0${ref.relativePath}`)),
        ) ?? null
      );
    },
  };
};
