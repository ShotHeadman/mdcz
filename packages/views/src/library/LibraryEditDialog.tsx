import type { LibraryEditJobDto } from "@mdcz/shared/libraryEdit";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@mdcz/ui";
import { useT } from "../i18n";
import { LibraryEditForm, type LibraryEditFormProps } from "./LibraryEditForm";

export function LibraryEditDialog({
  open,
  onOpenChange,
  job,
  loading,
  error,
  onNewEdit,
  ...form
}: LibraryEditFormProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: LibraryEditJobDto | null;
  loading?: boolean;
  error?: string | null;
  onNewEdit: () => void;
}) {
  const t = useT();
  const labels = t.library.edit;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{labels.title(job?.total ?? form.entries.length)}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status">{labels.loading}</p>
        ) : job ? (
          <div className="grid gap-4" aria-live="polite">
            <p>
              {job.status === "running"
                ? labels.running(job.current, job.total)
                : job.status === "failed"
                  ? labels.failed
                  : labels.completed}
            </p>
            {job.status === "running" && <progress className="w-full" value={job.current} max={job.total} />}
            <p className="text-sm text-muted-foreground">
              {labels.result(job.changed, job.unchanged, job.skipped, job.failures.length)}
            </p>
            {job.error && (
              <p role="alert" className="text-destructive">
                {job.error}
              </p>
            )}
            {job.failures.length > 0 && (
              <ul className="max-h-48 overflow-y-auto text-sm text-destructive">
                {job.failures.map((failure) => (
                  <li key={failure.id}>
                    {failure.id}: {failure.reason}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end gap-2">
              {job.status !== "running" && (
                <Button variant="outline" onClick={onNewEdit}>
                  {labels.newEdit}
                </Button>
              )}
              <Button onClick={() => onOpenChange(false)}>{labels.close}</Button>
            </div>
          </div>
        ) : (
          <LibraryEditForm {...form} onCancel={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}
