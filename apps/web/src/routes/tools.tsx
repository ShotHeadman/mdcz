import { toErrorMessage } from "@mdcz/shared/error";
import { TOOL_DEFINITIONS, type ToolId } from "@mdcz/shared/toolCatalog";
import { DiagnosticsPanelView, ToolCardIcon, ToolCatalogView } from "@mdcz/views/tools";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../client";
import { ErrorBanner, formatDate } from "../routeCommon";
import { Button } from "../ui";
import { ToolDetail } from "./tools/ToolDetail";

const DiagnosticsPanel = () => {
  const diagnosticsQ = useQuery({ queryKey: ["diagnostics"], queryFn: () => api.diagnostics.summary(), retry: false });
  return (
    <DiagnosticsPanelView
      checks={diagnosticsQ.data?.checks ?? []}
      error={diagnosticsQ.error ? <ErrorBanner>{toErrorMessage(diagnosticsQ.error)}</ErrorBanner> : undefined}
      formatDate={formatDate}
      onRefresh={() => void diagnosticsQ.refetch()}
    />
  );
};

export const ToolsPage = () => {
  const pageScrollRef = useRef<HTMLDivElement>(null);
  const [selectedToolId, setSelectedToolId] = useState<ToolId | null>(null);

  const scrollToTop = () => {
    window.requestAnimationFrame(() => {
      pageScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  const handleSelectTool = (toolId: ToolId) => {
    setSelectedToolId(toolId);
    scrollToTop();
  };

  return (
    <div ref={pageScrollRef} className="h-full w-full overflow-y-auto bg-surface-canvas scroll-smooth">
      {selectedToolId ? (
        <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-6 py-6 md:px-8 lg:px-10 lg:py-8">
          <div className="sticky top-0 z-10 w-fit rounded-full bg-surface-canvas/92 pt-1 backdrop-blur-sm">
            <Button
              className="h-12 w-12 rounded-full bg-surface-low text-foreground"
              variant="secondary"
              onClick={() => {
                setSelectedToolId(null);
                scrollToTop();
              }}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </div>
          <ToolDetail toolId={selectedToolId} />
          <DiagnosticsPanel />
        </main>
      ) : (
        <main className="mx-auto grid w-full max-w-[1120px] gap-6 px-6 py-8 md:px-8 lg:px-10 lg:py-10">
          <ToolCatalogView
            renderIcon={(tool) => <ToolCardIcon icon={tool.overviewIcon} />}
            tools={TOOL_DEFINITIONS}
            onSelect={handleSelectTool}
          />
          <DiagnosticsPanel />
        </main>
      )}
    </div>
  );
};

export const Route = createFileRoute("/tools")({
  component: ToolsPage,
});
