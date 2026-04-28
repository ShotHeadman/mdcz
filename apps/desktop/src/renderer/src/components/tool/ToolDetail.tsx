import type { ComponentType } from "react";
import { AmazonPoster } from "./AmazonPoster";
import { BatchNfoTranslator } from "./BatchNfoTranslator";
import { CrawlerTester } from "./CrawlerTester";
import { FileCleaner } from "./FileCleaner";
import { MissingNumberFinder } from "./MissingNumberFinder";
import { Person } from "./Person";
import { SingleFileScraper } from "./SingleFileScraper";
import { SymlinkManager } from "./SymlinkManager";
import type { ToolId } from "./toolCatalog";

interface ToolDetailProps {
  toolId: ToolId;
}

const TOOL_COMPONENTS: Record<ToolId, ComponentType> = {
  "single-file-scraper": SingleFileScraper,
  "crawler-tester": CrawlerTester,
  "amazon-poster": AmazonPoster,
  "media-library-tools": Person,
  "symlink-manager": SymlinkManager,
  "file-cleaner": FileCleaner,
  "batch-nfo-translator": BatchNfoTranslator,
  "missing-number-finder": MissingNumberFinder,
};

export function ToolDetail({ toolId }: ToolDetailProps) {
  const ActiveTool = TOOL_COMPONENTS[toolId];
  return <ActiveTool />;
}
