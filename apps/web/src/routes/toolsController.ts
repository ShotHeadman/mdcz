import type { ToolRunState } from "@mdcz/views/tools";

export const toRunState = (mutation: {
  isPending: boolean;
  data?: { data?: unknown };
  error: Error | null;
}): ToolRunState => ({
  pending: mutation.isPending,
  data: mutation.data?.data ?? mutation.data,
  error: mutation.error?.message,
});
