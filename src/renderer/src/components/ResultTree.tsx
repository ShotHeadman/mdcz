import { CheckCircle2, ChevronDown, ChevronRight, Copy, FileText, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { deleteFile, deleteFileAndFolder, requeueScrapeByNumber, requeueScrapeByUrl } from "@/api/manual";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/Collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/ContextMenu";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { TreeButton } from "@/components/ui/TreeButton";
import { cn } from "@/lib/utils";
import type { ScrapeResult } from "@/store/scrapeStore";
import { useScrapeStore } from "@/store/scrapeStore";
import { useUIStore } from "@/store/uiStore";

function getDirFromPath(filePath: string) {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (slash <= 0) return filePath;
  return filePath.slice(0, slash);
}

function getFileNameFromPath(filePath: string) {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return slash >= 0 ? filePath.slice(slash + 1) : filePath;
}

function ResultItem({ result }: { result: ScrapeResult }) {
  const { selectedResultId, setSelectedResultId } = useUIStore();

  const handleCopyNumber = async () => {
    if (!result.number) {
      toast.error("Number is empty");
      return;
    }
    try {
      await navigator.clipboard.writeText(result.number);
      toast.success("Number copied");
    } catch {
      toast.error("Failed to copy number");
    }
  };

  const handleRescrapeByNumber = async () => {
    const defaultNumber = result.number || "";
    const number = window.prompt("输入番号重新刮削", defaultNumber)?.trim();
    if (!number) return;
    try {
      const response = await requeueScrapeByNumber(result.path, number);
      toast.success(response.data?.message ?? "Queued re-scrape by number");
    } catch {
      toast.error("Failed to queue re-scrape by number");
    }
  };

  const handleRescrapeByUrl = async () => {
    const url = window.prompt("输入网址重新刮削", "")?.trim();
    if (!url) return;
    try {
      const response = await requeueScrapeByUrl(result.path, url);
      toast.success(response.data?.message ?? "Queued re-scrape by URL");
    } catch {
      toast.error("Failed to queue re-scrape by URL");
    }
  };

  const handleDeleteFile = async () => {
    if (!window.confirm(`确定删除文件吗？\n${result.path}`)) return;
    try {
      await deleteFile(result.path);
      toast.success("File deleted");
    } catch {
      toast.error("Failed to delete file");
    }
  };

  const handleDeleteFolder = async () => {
    if (!window.confirm(`确定删除文件和所在文件夹吗？\n${result.path}`)) return;
    try {
      await deleteFileAndFolder(result.path);
      toast.success("Folder deleted");
    } catch {
      toast.error("Failed to delete folder");
    }
  };

  const handleOpenFolder = () => {
    if (window.electron?.openPath) {
      const dir = getDirFromPath(result.path);
      window.electron.openPath(dir);
    } else {
      toast.info("Open folder is only available in desktop mode");
    }
  };

  const handlePlay = () => {
    if (window.electron?.openPath) {
      window.electron.openPath(result.path);
    } else {
      toast.info("Play is only available in desktop mode");
    }
  };

  const handleOpenNfo = () => {
    window.dispatchEvent(new CustomEvent("app:open-nfo", { detail: { path: result.path } }));
  };

  const isSelected = selectedResultId === result.id;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <TreeButton
          isSelected={isSelected}
          className="group flex-col items-start"
          onClick={() => setSelectedResultId(result.id)}
        >
          <div className="flex items-center gap-2 w-full">
            {result.status === "success" ? (
              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 text-red-500 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">
                {result.number || "Unknown"}
                <span className="text-muted-foreground font-normal ml-2">
                  {result.title || getFileNameFromPath(result.path)}
                </span>
              </div>
              {result.error_msg && <div className="text-xs text-red-500 truncate mt-0.5">{result.error_msg}</div>}
            </div>
          </div>
        </TreeButton>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={handleCopyNumber}>
          Copy number
          <ContextMenuShortcut>
            <Copy className="h-3.5 w-3.5" />
          </ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleRescrapeByNumber}>
          Re-scrape by number
          <ContextMenuShortcut>N</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={handleRescrapeByUrl}>
          Re-scrape by URL
          <ContextMenuShortcut>U</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleDeleteFile} className="text-destructive focus:text-destructive">
          Delete file
          <ContextMenuShortcut>D</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={handleDeleteFolder} className="text-destructive focus:text-destructive">
          Delete file and folder
          <ContextMenuShortcut>A</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleOpenFolder}>
          Open folder
          <ContextMenuShortcut>F</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={handleOpenNfo}>
          Edit NFO
          <ContextMenuShortcut>
            <FileText className="h-3.5 w-3.5" />
          </ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={handlePlay}>
          Play
          <ContextMenuShortcut>P</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function ResultGroup({
  title,
  icon,
  results,
  badgeClass,
}: {
  title: string;
  icon: React.ReactNode;
  results: ScrapeResult[];
  badgeClass: string;
}) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 hover:bg-accent/50 rounded-md text-sm font-medium">
        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {icon}
        <span>{title === "Success" ? "处理成功" : "处理失败"}</span>
        <Badge variant="outline" className={cn("ml-auto text-xs", badgeClass)}>
          {results.length}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-4 space-y-0.5">
          {results.map((result) => (
            <ResultItem key={result.id} result={result} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ResultTree() {
  const { results, clearResults } = useScrapeStore();

  const successResults = results.filter((r) => r.status === "success");
  const failedResults = results.filter((r) => r.status === "failed");

  return (
    <Card className="flex flex-col h-full border-0 shadow-none rounded-none bg-transparent pt-4">
      <CardHeader className="border-b shrink-0 pb-2!">
        <CardTitle className="text-sm font-bold flex justify-between items-center gap-2 tracking-tight">
          <span>处理结果列表</span>
          <div className="flex items-center">
            <div className="flex gap-2">
              <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 dark:bg-green-950/30">
                成功 {successResults.length}
              </Badge>
              <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50 dark:bg-red-950/30">
                失败 {failedResults.length}
              </Badge>
            </div>
            {results.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:text-destructive"
                onClick={clearResults}
                title="清空结果"
              >
                <Trash2 />
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-3 space-y-1">
            {results.length === 0 && (
              <div className="text-center text-muted-foreground py-12 text-xs opacity-60">
                暂无结果。启动刮削任务后，处理项将显示在此处。
              </div>
            )}

            {successResults.length > 0 && (
              <ResultGroup
                title="Success"
                icon={<CheckCircle2 className="h-4 w-4 text-green-500" />}
                results={successResults}
                badgeClass="text-green-600 border-green-200"
              />
            )}

            {failedResults.length > 0 && (
              <ResultGroup
                title="Failed"
                icon={<XCircle className="h-4 w-4 text-red-500" />}
                results={failedResults}
                badgeClass="text-red-600 border-red-200"
              />
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
