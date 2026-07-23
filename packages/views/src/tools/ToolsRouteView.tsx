import type { ToolDefinition, ToolId } from "@mdcz/shared/toolCatalog";
import { Button } from "@mdcz/ui";
import { ArrowLeft } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { ToolCatalogView } from "./ToolCatalogView";
import { ToolCardIcon } from "./ToolScaffold";

const SELECTED_TOOL_STORAGE_KEY = "mdcz:selected-tool-id";
const noopStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

const getToolStorage = (): Pick<Storage, "getItem" | "setItem" | "removeItem"> =>
  typeof sessionStorage !== "undefined" ? sessionStorage : noopStorage;

export interface ToolsRouteViewProps {
  tools: ToolDefinition[];
  renderDetail: (toolId: ToolId) => ReactNode;
}

export function ToolsRouteView({ tools, renderDetail }: ToolsRouteViewProps) {
  const pageScrollRef = useRef<HTMLDivElement>(null);
  const [selectedToolId, setSelectedToolId] = useState<ToolId | null>(() => {
    const storedToolId = getToolStorage().getItem(SELECTED_TOOL_STORAGE_KEY);
    return tools.some((tool) => tool.id === storedToolId) ? (storedToolId as ToolId) : null;
  });

  const setSelectedTool = (toolId: ToolId | null) => {
    setSelectedToolId(toolId);
    const storage = getToolStorage();

    if (toolId) {
      storage.setItem(SELECTED_TOOL_STORAGE_KEY, toolId);
    } else {
      storage.removeItem(SELECTED_TOOL_STORAGE_KEY);
    }
  };

  const scrollToTop = () => {
    window.requestAnimationFrame(() => {
      pageScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  const handleSelectTool = (toolId: ToolId) => {
    setSelectedTool(toolId);
    scrollToTop();
  };

  const handleBackToOverview = () => {
    setSelectedTool(null);
    scrollToTop();
  };

  return (
    <div ref={pageScrollRef} className="h-full w-full overflow-y-auto bg-surface-canvas scroll-smooth">
      {selectedToolId === null ? (
        <main className="mx-auto w-full max-w-[1120px] px-6 py-8 md:px-8 lg:px-10 lg:py-10">
          <ToolCatalogView
            renderIcon={(tool) => <ToolCardIcon icon={tool.overviewIcon} />}
            tools={tools}
            onSelect={handleSelectTool}
          />
        </main>
      ) : (
        <main className="mx-auto flex w-full max-w-[1120px] flex-col px-6 py-6 md:px-8 lg:px-10 lg:py-8">
          <div className="sticky top-0 z-10 mb-6 w-fit rounded-full bg-surface-canvas/92 pt-1 backdrop-blur-sm">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={handleBackToOverview}
              className="h-12 w-12 rounded-full bg-surface-low text-foreground shadow-[0_12px_24px_rgba(15,23,42,0.06)] hover:bg-surface-raised/80"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </div>

          {renderDetail(selectedToolId)}
          <div className="h-2" />
        </main>
      )}
    </div>
  );
}
