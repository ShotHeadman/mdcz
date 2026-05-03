import type { ToolDefinition, ToolId } from "@mdcz/shared/toolCatalog";
import type { ReactNode } from "react";

export interface ToolCatalogViewProps {
  tools: ToolDefinition[];
  onSelect: (toolId: ToolId) => void;
  renderIcon: (tool: ToolDefinition) => ReactNode;
}

const toolLayoutClass: Record<ToolDefinition["overviewLayoutClass"], string> = {
  "min-h-[170px] md:col-span-12 md:min-h-[190px]": "min-h-[170px] md:col-span-12 md:min-h-[190px]",
  "min-h-[190px] md:col-span-6 md:min-h-[208px]": "min-h-[190px] md:col-span-6 md:min-h-[208px]",
  "min-h-[300px] md:col-span-4 md:min-h-[320px]": "min-h-[300px] md:col-span-4 md:min-h-[320px]",
};

export const ToolCatalogView = ({ tools, onSelect, renderIcon }: ToolCatalogViewProps) => (
  <section className="grid gap-5 md:grid-cols-12">
    {tools.map((tool) => (
      <button
        className={`${toolLayoutClass[tool.overviewLayoutClass]} flex h-full cursor-pointer flex-col rounded-[2rem] bg-surface-low/80 p-8 text-left transition-colors duration-200 hover:bg-surface-floating focus-visible:ring-2 focus-visible:ring-ring/40`}
        key={tool.id}
        type="button"
        onClick={() => onSelect(tool.id)}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-quiet-capsule bg-surface-floating text-foreground shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
            {renderIcon(tool)}
          </div>
        </div>
        <div className="mt-auto pt-12">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground">{tool.title}</h2>
          <p className="mt-4 max-w-[26rem] text-sm leading-8 text-muted-foreground">{tool.description}</p>
        </div>
      </button>
    ))}
  </section>
);
