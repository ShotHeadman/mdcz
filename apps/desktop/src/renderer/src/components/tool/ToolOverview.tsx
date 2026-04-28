import { Bug, FileText, FolderOpen, Languages, Link2, Search, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TOOL_DEFINITIONS, type ToolId } from "./toolCatalog";

interface ToolOverviewProps {
  onSelect: (toolId: ToolId) => void;
}

function ToolCardIcon({ icon }: { icon: (typeof TOOL_DEFINITIONS)[number]["overviewIcon"] }) {
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
}

export function ToolOverview({ onSelect }: ToolOverviewProps) {
  return (
    <section>
      <div className="grid gap-5 md:grid-cols-12">
        {TOOL_DEFINITIONS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            onClick={() => onSelect(tool.id)}
            className={cn(
              "flex h-full flex-col rounded-[2rem] bg-surface-low/80 p-8 text-left transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/40 hover:bg-surface-floating",
              tool.overviewLayoutClass,
            )}
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-floating text-foreground shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
              <ToolCardIcon icon={tool.overviewIcon} />
            </div>

            <div className="mt-auto pt-12">
              <h2 className="text-[1.8rem] font-semibold tracking-tight text-foreground">{tool.title}</h2>
              <p className="mt-4 max-w-[26rem] text-sm leading-8 text-muted-foreground">{tool.description}</p>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
