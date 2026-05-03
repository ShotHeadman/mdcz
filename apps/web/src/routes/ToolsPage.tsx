import type { ToolDefinition, ToolId } from "@mdcz/shared/toolCatalog";
import { TOOL_DEFINITIONS } from "@mdcz/shared/toolCatalog";
import { ArrowLeft, Bug, FileText, FolderOpen, Languages, Link2, Search, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui";

const ToolCardIcon = ({ icon }: { icon: ToolDefinition["overviewIcon"] }) => {
  const iconClassName = "h-8 w-8";

  if (icon === "file") {
    return <FileText className={iconClassName} strokeWidth={1.8} />;
  }
  if (icon === "bug") {
    return <Bug className={iconClassName} strokeWidth={1.8} />;
  }
  if (icon === "folder") {
    return <FolderOpen className={iconClassName} strokeWidth={1.8} />;
  }
  if (icon === "link") {
    return <Link2 className={iconClassName} strokeWidth={1.8} />;
  }
  if (icon === "trash") {
    return <Trash2 className={iconClassName} strokeWidth={1.8} />;
  }
  if (icon === "translate") {
    return <Languages className={iconClassName} strokeWidth={1.8} />;
  }
  if (icon === "search") {
    return <Search className={iconClassName} strokeWidth={1.8} />;
  }

  return (
    <span className="relative text-[2.2rem] font-semibold leading-none lowercase tracking-tight">
      a
      <span className="absolute -bottom-1 left-1/2 h-[2px] w-6 -translate-x-1/2 rounded-full bg-current/75" />
    </span>
  );
};

const toolLayoutClass: Record<ToolDefinition["overviewLayoutClass"], string> = {
  "min-h-[170px] md:col-span-12 md:min-h-[190px]": "min-h-[170px] md:col-span-12 md:min-h-[190px]",
  "min-h-[190px] md:col-span-6 md:min-h-[208px]": "min-h-[190px] md:col-span-6 md:min-h-[208px]",
  "min-h-[300px] md:col-span-4 md:min-h-[320px]": "min-h-[300px] md:col-span-4 md:min-h-[320px]",
};

const ToolCard = ({ tool, onSelect }: { tool: ToolDefinition; onSelect: (toolId: ToolId) => void }) => (
  <button
    className={`${toolLayoutClass[tool.overviewLayoutClass]} flex h-full cursor-pointer flex-col rounded-[2rem] bg-surface-low/80 p-8 text-left transition-colors duration-200 hover:bg-surface-floating focus-visible:ring-2 focus-visible:ring-ring/40`}
    type="button"
    onClick={() => onSelect(tool.id)}
  >
    <div className="flex h-16 w-16 items-center justify-center rounded-quiet-capsule bg-surface-floating text-foreground shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
      <ToolCardIcon icon={tool.overviewIcon} />
    </div>
    <div className="mt-auto pt-12">
      <h2 className="text-3xl font-semibold tracking-tight text-foreground">{tool.title}</h2>
      <p className="mt-4 max-w-[26rem] text-sm leading-8 text-muted-foreground">{tool.description}</p>
    </div>
  </button>
);

export const ToolsPage = () => {
  const pageScrollRef = useRef<HTMLDivElement>(null);
  const [selectedToolId, setSelectedToolId] = useState<ToolId | null>(null);
  const selectedTool = selectedToolId ? TOOL_DEFINITIONS.find((tool) => tool.id === selectedToolId) : null;

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
      {selectedTool ? (
        <main className="mx-auto flex w-full max-w-[1120px] flex-col px-6 py-6 md:px-8 lg:px-10 lg:py-8">
          <div className="sticky top-0 z-10 mb-6 w-fit rounded-full bg-surface-canvas/92 pt-1 backdrop-blur-sm">
            <Button
              className="h-12 w-12 rounded-full bg-surface-low text-foreground"
              variant="secondary"
              onClick={handleBackToOverview}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{selectedTool.detailTitle}</CardTitle>
              <CardDescription>{selectedTool.detailDescription}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-7 text-muted-foreground">该工具的浏览器端操作入口尚未开放。</p>
            </CardContent>
          </Card>
        </main>
      ) : (
        <main className="mx-auto w-full max-w-[1120px] px-6 py-8 md:px-8 lg:px-10 lg:py-10">
          <section className="grid gap-5 md:grid-cols-12">
            {TOOL_DEFINITIONS.map((tool) => (
              <ToolCard key={tool.id} tool={tool} onSelect={handleSelectTool} />
            ))}
          </section>
        </main>
      )}
    </div>
  );
};
