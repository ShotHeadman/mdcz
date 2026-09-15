import type { PublicationJournalPort, PublicationJournalRecord } from "./types";

export const createMemoryPublicationJournal = (): PublicationJournalPort => {
  const entries = new Map<string, PublicationJournalRecord>();
  return {
    begin(entry) {
      if (entries.has(entry.operationId)) throw new Error(`Publication journal already exists: ${entry.operationId}`);
      entries.set(entry.operationId, { ...entry, manifest: structuredClone(entry.manifest), state: "pending" });
    },
    stage(operationId, manifest) {
      const entry = entries.get(operationId);
      if (entry?.state !== "pending") throw new Error(`Publication journal operation is not pending: ${operationId}`);
      entry.manifest = structuredClone(manifest);
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
  };
};
