import { BATCH_TRANSLATE_MODES } from "@mdcz/shared/briefCatalog";
import { TOOL_DEFINITIONS, type ToolId } from "@mdcz/shared/toolCatalog";
import type { BatchTranslateMode } from "@mdcz/shared/toolTypes";
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

/**
 * A link that opens one tool with its form filled in, such as a Brief card's. `open` changes with every opening, so the
 * same link opens the tool again after the user went back to the catalogue.
 */
export interface ToolsSearch {
  tool?: ToolId;
  directory?: string;
  mode?: BatchTranslateMode;
  open?: string;
}

export const parseToolsSearch = (search: Record<string, unknown>): ToolsSearch => ({
  tool: TOOL_DEFINITIONS.find((tool) => tool.id === search.tool)?.id,
  directory: typeof search.directory === "string" && search.directory ? search.directory : undefined,
  mode: BATCH_TRANSLATE_MODES.find((mode) => mode === search.mode),
  // The router reads a numeric value from the URL as a number.
  open: typeof search.open === "string" || typeof search.open === "number" ? String(search.open) : undefined,
});
