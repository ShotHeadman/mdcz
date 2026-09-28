import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@mdcz/ui";
import { useT } from "../i18n";

export function ScrapeStartErrorDialog({ error, onClose }: { error: unknown; onClose(): void }) {
  const t = useT();
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
          <DialogTitle>{t.scrape.incompleteTitle}</DialogTitle>
          <DialogDescription>{t.scrape.incompleteDesc}</DialogDescription>
        </DialogHeader>
        <div role="alert" className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-all font-mono text-xs">
          {message}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{t.scrape.understood}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
