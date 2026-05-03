import type { DiagnosticCheckDto } from "@mdcz/shared/serverDtos";
import type { ToolDefinition } from "@mdcz/shared/toolCatalog";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Label } from "@mdcz/ui";
import { Bug, FileText, FolderOpen, Languages, Link2, Search, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

export const ToolCardIcon = ({ icon }: { icon: ToolDefinition["overviewIcon"] }) => {
  const iconClassName = "h-8 w-8";

  if (icon === "file") return <FileText className={iconClassName} strokeWidth={1.8} />;
  if (icon === "bug") return <Bug className={iconClassName} strokeWidth={1.8} />;
  if (icon === "folder") return <FolderOpen className={iconClassName} strokeWidth={1.8} />;
  if (icon === "link") return <Link2 className={iconClassName} strokeWidth={1.8} />;
  if (icon === "trash") return <Trash2 className={iconClassName} strokeWidth={1.8} />;
  if (icon === "translate") return <Languages className={iconClassName} strokeWidth={1.8} />;
  if (icon === "search") return <Search className={iconClassName} strokeWidth={1.8} />;

  return (
    <span className="relative text-[2.2rem] font-semibold leading-none lowercase tracking-tight">
      a
      <span className="absolute -bottom-1 left-1/2 h-[2px] w-6 -translate-x-1/2 rounded-full bg-current/75" />
    </span>
  );
};

export const ToolShell = ({ tool, children }: { tool: ToolDefinition; children: ReactNode }) => (
  <Card>
    <CardHeader>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{tool.detailTitle}</CardTitle>
          <CardDescription>{tool.detailDescription}</CardDescription>
        </div>
        <Badge>WebUI 可用</Badge>
      </div>
    </CardHeader>
    <CardContent className="space-y-5">{children}</CardContent>
  </Card>
);

export const ToolField = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid gap-2">
    <Label>{label}</Label>
    {children}
  </div>
);

export interface DiagnosticsPanelViewProps {
  checks: DiagnosticCheckDto[];
  error?: ReactNode;
  formatDate: (value: string) => string;
  onRefresh: () => void;
}

export const DiagnosticsPanelView = ({ checks, error, formatDate, onRefresh }: DiagnosticsPanelViewProps) => (
  <Card>
    <CardHeader>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>诊断</CardTitle>
          <CardDescription>检查持久化、媒体目录、爬虫、网络、翻译与媒体服务器运行条件。</CardDescription>
        </div>
        <Button variant="secondary" onClick={onRefresh}>
          刷新诊断
        </Button>
      </div>
    </CardHeader>
    <CardContent className="grid gap-3">
      {error}
      {checks.map((check) => (
        <div
          key={check.id}
          className="grid gap-2 rounded-quiet border border-border/50 bg-surface-low/50 p-4 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center"
        >
          <Badge variant={check.ok ? "default" : "destructive"}>{check.ok ? "OK" : "ERR"}</Badge>
          <div className="min-w-0">
            <p className="font-medium text-foreground">{check.label}</p>
            <p className="break-all text-sm text-muted-foreground">{check.message}</p>
          </div>
          <span className="font-mono text-xs text-muted-foreground">{formatDate(check.checkedAt)}</span>
        </div>
      ))}
      {checks.length === 0 && <p className="text-sm text-muted-foreground">暂无诊断结果。</p>}
    </CardContent>
  </Card>
);
