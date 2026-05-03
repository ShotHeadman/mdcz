import { ToolCardIcon, ToolCatalogView } from "@mdcz/views/tools";
import { TOOL_DEFINITIONS, type ToolId } from "./toolCatalog";

interface ToolOverviewProps {
  onSelect: (toolId: ToolId) => void;
}

export function ToolOverview({ onSelect }: ToolOverviewProps) {
  return (
    <ToolCatalogView
      renderIcon={(tool) => <ToolCardIcon icon={tool.overviewIcon} />}
      tools={TOOL_DEFINITIONS}
      onSelect={onSelect}
    />
  );
}
