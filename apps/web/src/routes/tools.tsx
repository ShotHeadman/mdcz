import { createFileRoute } from "@tanstack/react-router";
import { parseToolsSearch } from "./toolsController";

// The page itself is drawn by the root layout, which keeps it mounted so a browser-driven tool keeps running.
export const Route = createFileRoute("/tools")({
  validateSearch: parseToolsSearch,
  component: () => null,
});
