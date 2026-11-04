import type { PendingListResponse } from "@mdcz/shared/pending";
import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";

/** Rereads the pending list before any detail: a handled item has left it, and rereading its detail answers 404. */
export const refreshPendingQueries = async (queryClient: QueryClient): Promise<void> => {
  await queryClient.refetchQueries({ queryKey: queryKeys.pending.all, exact: true });
  const remaining = queryClient.getQueryData<PendingListResponse>(queryKeys.pending.all);
  const [scope, kind] = queryKeys.pending.detail("");
  if (remaining) {
    const remainingIds = new Set(remaining.items.map((item) => item.id));
    queryClient.removeQueries({
      predicate: ({ queryKey }) =>
        queryKey[0] === scope && queryKey[1] === kind && !remainingIds.has(String(queryKey[2])),
    });
  }
  await queryClient.invalidateQueries({ queryKey: [scope, kind] });
};
