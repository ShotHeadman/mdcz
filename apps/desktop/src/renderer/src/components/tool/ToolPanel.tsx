import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { TOOL_DEFINITIONS_BY_ID, type ToolId } from "./toolCatalog";
import { TOOL_PANEL_CLASS } from "./toolStyles";

interface ToolPanelProps {
  toolId: ToolId;
  icon: ReactNode;
  children: ReactNode;
  headerExtra?: ReactNode;
}

export function ToolPanel({ toolId, icon, children, headerExtra }: ToolPanelProps) {
  const tool = TOOL_DEFINITIONS_BY_ID[toolId];

  return (
    <Card className={TOOL_PANEL_CLASS}>
      <CardHeader className="px-6 pt-6 pb-0 md:px-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-low text-foreground">
              {icon}
            </div>
            <div className="min-w-0">
              <CardTitle className="text-lg font-semibold tracking-tight">{tool.detailTitle}</CardTitle>
              <CardDescription className="mt-1 text-sm leading-6">{tool.detailDescription}</CardDescription>
            </div>
          </div>

          {headerExtra ? <div className="flex shrink-0 flex-wrap items-center gap-2">{headerExtra}</div> : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-6 px-6 py-6 md:px-7 md:py-7">{children}</CardContent>
    </Card>
  );
}
