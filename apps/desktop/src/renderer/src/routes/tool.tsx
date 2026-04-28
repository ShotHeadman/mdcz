import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useRef, useState } from "react";
import { ToolDetail } from "@/components/tool/ToolDetail";
import { ToolOverview } from "@/components/tool/ToolOverview";
import type { ToolId } from "@/components/tool/toolCatalog";
import { Button } from "@/components/ui/Button";

export const Route = createFileRoute("/tool")({
  component: ToolComponent,
});

function ToolComponent() {
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

  const handleBackToOverview = () => {
    setSelectedToolId(null);
    scrollToTop();
  };

  return (
    <div ref={pageScrollRef} className="h-full w-full overflow-y-auto bg-surface-canvas scroll-smooth">
      {selectedToolId === null ? (
        <main className="mx-auto w-full max-w-[1120px] px-6 py-8 md:px-8 lg:px-10 lg:py-10">
          <ToolOverview onSelect={handleSelectTool} />
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

          <ToolDetail toolId={selectedToolId} />
          <div className="h-2" />
        </main>
      )}
    </div>
  );
}
