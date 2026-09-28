import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@mdcz/ui";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useT } from "../i18n";

export interface ReturnToWorkbenchSetupButtonProps {
  className?: string;
  disabled?: boolean;
  dialogDescription?: string;
  dialogTitle?: string;
  onConfirm: () => void;
}

export function ReturnToWorkbenchSetupButton({
  className,
  disabled = false,
  dialogDescription,
  dialogTitle,
  onConfirm,
}: ReturnToWorkbenchSetupButtonProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const resolvedTitle = dialogTitle ?? t.workbench.returnDialogTitle;
  const resolvedDescription = dialogDescription ?? t.workbench.returnDialogDescription;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn("rounded-quiet-capsule", className)}
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={resolvedTitle}
        title={resolvedTitle}
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{resolvedTitle}</DialogTitle>
            <DialogDescription>{resolvedDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              {t.workbench.confirmReturn}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
