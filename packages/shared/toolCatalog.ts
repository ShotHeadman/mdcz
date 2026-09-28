export type ToolId =
  | "single-file-scraper"
  | "crawler-tester"
  | "amazon-poster"
  | "media-library-tools"
  | "symlink-manager"
  | "batch-nfo-translator";

export type ToolOverviewLayout = "featuredThird" | "standardHalf" | "compactHalf" | "compactFull";

/** Tool titles and descriptions live in the UI locale dictionaries, keyed by ToolId. */
export interface ToolDefinition {
  id: ToolId;
  overviewLayout: ToolOverviewLayout;
  overviewIcon: "file" | "bug" | "amazon" | "folder" | "link" | "translate" | "search";
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  { id: "single-file-scraper", overviewLayout: "featuredThird", overviewIcon: "file" },
  { id: "crawler-tester", overviewLayout: "featuredThird", overviewIcon: "bug" },
  { id: "amazon-poster", overviewLayout: "featuredThird", overviewIcon: "amazon" },
  { id: "media-library-tools", overviewLayout: "standardHalf", overviewIcon: "folder" },
  { id: "symlink-manager", overviewLayout: "standardHalf", overviewIcon: "link" },
  { id: "batch-nfo-translator", overviewLayout: "compactFull", overviewIcon: "translate" },
];
