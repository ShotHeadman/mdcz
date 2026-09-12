import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@mdcz/ui";

export function ScrapeStartErrorDialog({ error, onClose }: { error: unknown; onClose(): void }) {
  const message = (
    error && typeof error === "object" && "message" in error && typeof error.message === "string"
      ? error.message
      : String(error ?? "")
  )
    .replace(/^Error invoking remote method '[^']+':\s*/u, "")
    .trim();

  return (
    <Dialog open={error !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>刮削任务未能完成</DialogTitle>
          <DialogDescription>请查看任务结果，处理以下问题后重试：</DialogDescription>
        </DialogHeader>
        <div role="alert" className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-all font-mono text-xs">
          {message}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>我知道了</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
